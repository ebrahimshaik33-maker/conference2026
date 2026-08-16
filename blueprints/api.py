import os
import csv
import io
import json
import shutil
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app, send_file
from flask_login import login_required, current_user
from werkzeug.utils import secure_filename

from models import db, Session, Setting, AuditLog, PushSubscription
from blueprints.auth import validate_csrf

api_bp = Blueprint('api', __name__)

ALLOWED_SESSION_TYPES = {'session', 'keynote', 'break', 'panel', 'workshop', 'general'}
ALLOWED_STATUSES = {'', 'cancelled', 'delayed', 'moved'}
ALLOWED_IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.svg', '.webp'}
ALLOWED_PAPER_EXTENSIONS = {'.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.rtf', '.odt'}


def _normalize_time(t):
    """Normalize and validate time string to HH:MM format."""
    if not t:
        return ''
    t = str(t).strip()
    parts = t.split(':')
    if len(parts) == 2:
        try:
            h = int(parts[0])
            m = int(parts[1])
            if 0 <= h <= 23 and 0 <= m <= 59:
                return f"{h:02d}:{m:02d}"
        except (ValueError, TypeError):
            pass
    return None


def _is_valid_time(t):
    """Check if time string is valid HH:MM format."""
    return _normalize_time(t) is not None


def _normalize_url(url):
    """Normalize URL strings to include http:// or https:// if missing."""
    if not url or not str(url).strip():
        return ''
    url = str(url).strip()
    if url.startswith(('http://', 'https://', '/')):
        return url
    return f'https://{url}'


def _validate_session_data(data, is_update=False):
    """Validate session data and return errors dict."""
    errors = {}

    if not is_update or 'day' in data:
        day = data.get('day')
        if day is None or day == '':
            errors['day'] = 'Day is required'
        else:
            try:
                day_int = int(day)
                if day_int < 1:
                    errors['day'] = 'Day must be a positive integer'
            except (ValueError, TypeError):
                errors['day'] = 'Day must be a valid integer'

    if not is_update or 'start_time' in data:
        start_time = data.get('start_time', '')
        normalized = _normalize_time(start_time)
        if not start_time:
            errors['start_time'] = 'Start time is required'
        elif normalized is None:
            errors['start_time'] = 'Start time must be a valid time (e.g. 09:00 or 14:30)'
        else:
            data['start_time'] = normalized

    if 'end_time' in data and data['end_time']:
        normalized = _normalize_time(data['end_time'])
        if normalized is None:
            errors['end_time'] = 'End time must be a valid time (e.g. 10:30)'
        else:
            data['end_time'] = normalized

    if not is_update or 'title' in data:
        title = data.get('title', '')
        if not title or not str(title).strip():
            errors['title'] = 'Title is required'

    if 'type' in data and data['type']:
        if data['type'] not in ALLOWED_SESSION_TYPES:
            errors['type'] = f'Type must be one of: {", ".join(ALLOWED_SESSION_TYPES)}'

    if 'status' in data and data['status']:
        if data['status'] not in ALLOWED_STATUSES:
            errors['status'] = f'Status must be one of: {", ".join(ALLOWED_STATUSES)}'

    if 'paper_url' in data and data['paper_url']:
        data['paper_url'] = _normalize_url(data['paper_url'])

    if 'evaluation_url' in data and data['evaluation_url']:
        data['evaluation_url'] = _normalize_url(data['evaluation_url'])

    if 'meeting_url' in data and data['meeting_url']:
        data['meeting_url'] = _normalize_url(data['meeting_url'])

    return errors


def _log_audit(action, detail):
    """Create an audit log entry."""
    log = AuditLog(
        user_id=current_user.id if current_user.is_authenticated else None,
        action=action,
        detail=json.dumps(detail) if isinstance(detail, dict) else str(detail)
    )
    db.session.add(log)


def _process_image(file, image_type='logo'):
    """Validate and process uploaded image. Returns saved filename or None."""
    if not file or not file.filename:
        return None

    filename = secure_filename(file.filename)
    ext = os.path.splitext(filename)[1].lower()

    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return None

    # Generate unique filename
    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    new_filename = f'{image_type}_{timestamp}{ext}'

    upload_dir = os.path.join(current_app.root_path, current_app.config['UPLOAD_FOLDER'])
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, new_filename)

    # For SVG files, just save directly
    if ext == '.svg':
        file.save(filepath)
        return new_filename

    # For raster images, validate and resize with Pillow
    try:
        from PIL import Image

        img = Image.open(file)
        img.verify()
        file.seek(0)
        img = Image.open(file)

        # Max dimensions
        if image_type == 'logo':
            max_size = (400, 200)
        else:
            max_size = (2000, 400)

        # Resize if too large
        if img.width > max_size[0] or img.height > max_size[1]:
            img.thumbnail(max_size, Image.LANCZOS)

        # Convert RGBA to RGB for JPEG
        if ext in ('.jpg', '.jpeg') and img.mode == 'RGBA':
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background

        img.save(filepath, quality=90)
    except Exception:
        return None

    return new_filename


# ─── Sessions API ─────────────────────────────────────────────

@api_bp.route('/sessions', methods=['GET'])
def get_sessions():
    sessions = Session.query.order_by(
        Session.day, Session.start_time, Session.display_order
    ).all()
    return jsonify([s.to_dict() for s in sessions])


@api_bp.route('/sessions/<int:session_id>', methods=['GET'])
def get_session(session_id):
    session = db.session.get(Session, session_id)
    if not session:
        return jsonify({'status': 'error', 'message': 'Session not found'}), 404
    return jsonify(session.to_dict())


@api_bp.route('/sessions', methods=['POST'])
@login_required
@validate_csrf
def create_session():
    data = request.get_json()
    if not data:
        return jsonify({'status': 'error', 'message': 'No data provided'}), 400

    errors = _validate_session_data(data)
    if errors:
        return jsonify({'status': 'error', 'message': 'Validation failed', 'errors': errors}), 400

    session = Session(
        day=int(data['day']),
        start_time=data['start_time'],
        end_time=data.get('end_time', ''),
        title=data['title'].strip(),
        presenter=data.get('presenter', ''),
        affiliation=data.get('affiliation', ''),
        bio=data.get('bio', ''),
        location=data.get('location', ''),
        track=data.get('track', ''),
        type=data.get('type', 'session'),
        paper_url=data.get('paper_url', ''),
        evaluation_url=data.get('evaluation_url', ''),
        meeting_url=data.get('meeting_url', ''),
        description=data.get('description', ''),
        menu_details=data.get('menu_details', ''),
        status=data.get('status', ''),
        moved_to=data.get('moved_to', ''),
        display_order=int(data.get('display_order', 0)),
    )
    db.session.add(session)

    _log_audit('CREATE_SESSION', {'title': session.title, 'day': session.day})
    db.session.commit()

    return jsonify({'status': 'success', 'session': session.to_dict()}), 201


@api_bp.route('/sessions/<int:session_id>', methods=['PUT'])
@login_required
@validate_csrf
def update_session(session_id):
    session = db.session.get(Session, session_id)
    if not session:
        return jsonify({'status': 'error', 'message': 'Session not found'}), 404

    data = request.get_json()
    if not data:
        return jsonify({'status': 'error', 'message': 'No data provided'}), 400

    errors = _validate_session_data(data, is_update=True)
    if errors:
        return jsonify({'status': 'error', 'message': 'Validation failed', 'errors': errors}), 400

    old_data = session.to_dict()

    # Update fields
    updatable = [
        'day', 'start_time', 'end_time', 'title', 'presenter', 'affiliation',
        'bio', 'location', 'track', 'type', 'paper_url', 'evaluation_url', 'meeting_url',
        'description', 'menu_details', 'status', 'moved_to', 'display_order'
    ]
    for field in updatable:
        if field in data:
            value = data[field]
            if field == 'day':
                value = int(value)
            elif field == 'display_order':
                value = int(value) if value else 0
            elif field == 'title':
                value = value.strip() if value else value
            setattr(session, field, value)

    _log_audit('UPDATE_SESSION', {
        'id': session_id,
        'title': session.title,
        'changes': {k: {'old': old_data.get(k), 'new': data[k]} for k in data if k in updatable and str(old_data.get(k, '')) != str(data[k])}
    })
    db.session.commit()

    return jsonify({'status': 'success', 'session': session.to_dict()})


@api_bp.route('/sessions/<int:session_id>', methods=['DELETE'])
@login_required
@validate_csrf
def delete_session(session_id):
    session = db.session.get(Session, session_id)
    if not session:
        return jsonify({'status': 'error', 'message': 'Session not found'}), 404

    _log_audit('DELETE_SESSION', {'id': session_id, 'title': session.title, 'day': session.day})
    db.session.delete(session)
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Session deleted'})


@api_bp.route('/sessions/bulk-delete', methods=['POST'])
@login_required
@validate_csrf
def bulk_delete_sessions():
    data = request.get_json()
    if not data or 'ids' not in data:
        return jsonify({'status': 'error', 'message': 'No IDs provided'}), 400

    ids = data['ids']
    if not isinstance(ids, list):
        return jsonify({'status': 'error', 'message': 'IDs must be a list'}), 400

    sessions = Session.query.filter(Session.id.in_(ids)).all()
    titles = [s.title for s in sessions]
    count = len(sessions)

    for s in sessions:
        db.session.delete(s)

    _log_audit('BULK_DELETE_SESSIONS', {'count': count, 'ids': ids, 'titles': titles})
    db.session.commit()

    return jsonify({'status': 'success', 'message': f'{count} sessions deleted', 'deleted': count})


@api_bp.route('/sessions/reorder', methods=['POST'])
@login_required
@validate_csrf
def reorder_sessions():
    data = request.get_json()
    if not data or 'orders' not in data:
        return jsonify({'status': 'error', 'message': 'No order data provided'}), 400

    for item in data['orders']:
        session = db.session.get(Session, item.get('id'))
        if session:
            session.display_order = int(item.get('display_order', 0))

    _log_audit('REORDER_SESSIONS', {'count': len(data['orders'])})
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Sessions reordered'})


@api_bp.route('/sessions/export/csv', methods=['GET'])
@login_required
def export_csv():
    sessions = Session.query.order_by(Session.day, Session.start_time, Session.display_order).all()

    output = io.StringIO()
    writer = csv.writer(output)

    headers = [
        'id', 'day', 'start_time', 'end_time', 'title', 'presenter', 'affiliation',
        'bio', 'location', 'track', 'type', 'paper_url', 'evaluation_url', 'meeting_url',
        'description', 'menu_details', 'status', 'moved_to', 'display_order'
    ]
    writer.writerow(headers)

    for s in sessions:
        writer.writerow([
            s.id, s.day, s.start_time, s.end_time or '', s.title,
            s.presenter or '', s.affiliation or '', s.bio or '', s.location or '',
            s.track or '', s.type, s.paper_url or '', s.evaluation_url or '',
            s.meeting_url or '', s.description or '', s.menu_details or '',
            s.status or '', s.moved_to or '', s.display_order
        ])

    output.seek(0)
    return send_file(
        io.BytesIO(output.getvalue().encode('utf-8-sig')),
        mimetype='text/csv',
        as_attachment=True,
        download_name=f'sessions_export_{datetime.now().strftime("%Y%m%d_%H%M%S")}.csv'
    )


@api_bp.route('/upload_csv', methods=['POST'])
@login_required
@validate_csrf
def upload_csv():
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'No file provided'}), 400

    file = request.files['file']
    if not file.filename or not file.filename.endswith('.csv'):
        return jsonify({'status': 'error', 'message': 'File must be a CSV'}), 400

    mode = request.form.get('mode', 'merge')
    if mode not in ('replace', 'merge'):
        return jsonify({'status': 'error', 'message': 'Mode must be "replace" or "merge"'}), 400

    raw_delimiter = request.form.get('delimiter') or request.form.get('separator', ',')
    delimiter_map = {
        ',': ',',
        ';': ';',
        ':': ':',
        '\\t': '\t',
        'tab': '\t',
        't': '\t',
    }
    chosen_delimiter = delimiter_map.get(raw_delimiter, ',')

    try:
        content = file.read().decode('utf-8-sig')
        if raw_delimiter == 'auto':
            try:
                sample = content[:2048]
                sniffer = csv.Sniffer()
                sniffed = sniffer.sniff(sample)
                chosen_delimiter = sniffed.delimiter
            except Exception:
                chosen_delimiter = ','

        reader = csv.DictReader(io.StringIO(content), delimiter=chosen_delimiter)
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to parse CSV: {str(e)}'}), 400

    inserted = 0
    updated = 0
    skipped = 0
    skipped_rows = []

    if mode == 'replace':
        old_count = Session.query.count()
        Session.query.delete()
        _log_audit('CSV_REPLACE_ALL', {'old_count': old_count})

    for row_num, row in enumerate(reader, start=2):
        # Normalize headers (strip whitespace, lowercase)
        row = {k.strip().lower().replace(' ', '_'): v.strip() if v else '' for k, v in row.items() if k}

        # Validate required fields
        day = row.get('day', '')
        start_time = row.get('start_time', '')
        title = row.get('title', '')

        if not day or not start_time or not title:
            skipped += 1
            missing = []
            if not day:
                missing.append('day')
            if not start_time:
                missing.append('start_time')
            if not title:
                missing.append('title')
            skipped_rows.append({'row': row_num, 'reason': f'Missing: {", ".join(missing)}'})
            continue

        try:
            day_int = int(day)
            if day_int < 1:
                raise ValueError
        except (ValueError, TypeError):
            skipped += 1
            skipped_rows.append({'row': row_num, 'reason': f'Invalid day value: {day}'})
            continue

        norm_start = _normalize_time(start_time)
        if not norm_start:
            skipped += 1
            skipped_rows.append({'row': row_num, 'reason': f'Invalid start_time: {start_time}'})
            continue

        raw_end = row.get('end_time', '')
        norm_end = _normalize_time(raw_end) if raw_end else None

        # Validate type
        session_type = row.get('type', 'session')
        if session_type not in ALLOWED_SESSION_TYPES:
            session_type = 'session'

        # Validate status
        status = row.get('status', '')
        if status not in ALLOWED_STATUSES:
            status = ''

        # Parse display order safely
        try:
            disp_order = int(row.get('display_order', 0) or 0)
        except (ValueError, TypeError):
            disp_order = 0

        # Build session data
        bio_val = row.get('bio', '') or row.get('short_bio', '') or row.get('speaker_bio', '') or row.get('presenter_bio', '')
        meeting_val = (
            row.get('meeting_url', '') or row.get('zoom_url', '') or
            row.get('teams_url', '') or row.get('stream_url', '') or
            row.get('online_url', '') or row.get('video_url', '') or
            row.get('join_url', '') or row.get('meeting_link', '') or
            row.get('teams_link', '') or row.get('zoom_link', '') or
            row.get('online_link', '') or row.get('virtual_url', '')
        )
        session_data = {
            'day': day_int,
            'start_time': norm_start,
            'end_time': norm_end,
            'title': title,
            'presenter': row.get('presenter', ''),
            'affiliation': row.get('affiliation', ''),
            'bio': bio_val,
            'location': row.get('location', ''),
            'track': row.get('track', ''),
            'type': session_type,
            'paper_url': row.get('paper_url', ''),
            'evaluation_url': row.get('evaluation_url', ''),
            'meeting_url': meeting_val,
            'description': row.get('description', ''),
            'menu_details': row.get('menu_details', ''),
            'status': status,
            'moved_to': row.get('moved_to', ''),
            'display_order': disp_order,
        }

        # Merge mode: update existing if ID matches
        if mode == 'merge' and row.get('id'):
            try:
                existing_id = int(row['id'])
                existing = db.session.get(Session, existing_id)
                if existing:
                    for key, value in session_data.items():
                        setattr(existing, key, value)
                    updated += 1
                    continue
            except (ValueError, TypeError):
                pass

        # Insert new
        new_session = Session(**session_data)
        db.session.add(new_session)
        inserted += 1

    _log_audit('CSV_UPLOAD', {
        'mode': mode,
        'inserted': inserted,
        'updated': updated,
        'skipped': skipped,
        'filename': file.filename
    })
    db.session.commit()

    return jsonify({
        'status': 'success',
        'report': {
            'inserted': inserted,
            'updated': updated,
            'skipped': skipped,
            'skipped_rows': skipped_rows
        }
    })


@api_bp.route('/upload_paper', methods=['POST'])
@login_required
@validate_csrf
def upload_paper():
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'No file provided'}), 400

    file = request.files['file']
    if not file or not file.filename:
        return jsonify({'status': 'error', 'message': 'No file selected'}), 400

    orig_filename = secure_filename(file.filename)
    ext = os.path.splitext(orig_filename)[1].lower()

    if ext not in ALLOWED_PAPER_EXTENSIONS:
        return jsonify({
            'status': 'error',
            'message': f'Invalid file format ({ext}). Allowed: PDF, DOC, DOCX, PPT, PPTX, TXT, RTF'
        }), 400

    timestamp = datetime.now().strftime('%Y%m%d%H%M%S')
    base_name = os.path.splitext(orig_filename)[0][:35]
    new_filename = f'paper_{timestamp}_{base_name}{ext}'

    upload_dir = os.path.join(current_app.root_path, current_app.config['UPLOAD_FOLDER'])
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, new_filename)

    try:
        file.save(filepath)
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to save paper: {str(e)}'}), 500

    file_url = f'/static/uploads/{new_filename}'
    _log_audit('UPLOAD_PAPER', {'filename': new_filename, 'original': file.filename})

    return jsonify({
        'status': 'success',
        'url': file_url,
        'filename': orig_filename,
        'saved_as': new_filename
    })


# ─── Settings API ─────────────────────────────────────────────

@api_bp.route('/settings', methods=['GET'])
def get_settings():
    settings = Setting.query.all()
    return jsonify({s.key: s.value for s in settings})


@api_bp.route('/settings', methods=['POST'])
@login_required
@validate_csrf
def update_settings():
    old_settings = {s.key: s.value for s in Setting.query.all()}
    changes = {}

    # Handle file uploads
    for file_key in ('logo', 'banner', 'favicon', 'custom_bg'):
        if file_key in request.files:
            file = request.files[file_key]
            if file and file.filename:
                new_filename = _process_image(file, file_key)
                if new_filename:
                    setting_key = f'{file_key}_path'
                    # Delete old file
                    old_path = old_settings.get(setting_key, '')
                    if old_path:
                        old_file = os.path.join(current_app.root_path, current_app.config['UPLOAD_FOLDER'], old_path)
                        if os.path.exists(old_file):
                            os.remove(old_file)

                    setting = db.session.get(Setting, setting_key)
                    if setting:
                        setting.value = new_filename
                    else:
                        db.session.add(Setting(key=setting_key, value=new_filename))
                    changes[setting_key] = new_filename
                else:
                    return jsonify({'status': 'error', 'message': f'Invalid {file_key} file. Allowed: PNG, JPG, SVG, WEBP. Max 5MB.'}), 400

    # Handle text/select fields
    if request.content_type and 'multipart/form-data' in request.content_type:
        form_data = request.form.to_dict()
    elif request.is_json:
        form_data = request.get_json()
    else:
        form_data = request.form.to_dict()

    text_keys = [
        'event_title', 'event_subtitle', 'event_description',
        'event_start_date', 'event_days', 'theme', 'layout', 'ui_style',
        'show_track_filter', 'show_evaluation_links', 'show_calendar_links',
        'show_live_tracker',
        'announcement', 'announcement_type', 'footer_text',
        'show_top_banner', 'show_footer_banner',
        # Branding
        'brand_title_color', 'brand_heading_font', 'brand_body_font',
        # Custom theme colours
        'custom_primary', 'custom_accent', 'custom_bg',
        'custom_surface', 'custom_text', 'custom_header_bg',
        'custom_heading_font', 'custom_body_font',
        # Push notification toggle
        'push_enabled',
        # Analytics
        'google_analytics_id',
    ]

    for key in text_keys:
        if key in form_data:
            setting = db.session.get(Setting, key)
            if setting:
                setting.value = form_data[key]
            else:
                db.session.add(Setting(key=key, value=form_data[key]))
            if old_settings.get(key) != form_data[key]:
                changes[key] = form_data[key]

    _log_audit('UPDATE_SETTINGS', changes)
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Settings saved'})


@api_bp.route('/settings/reset-logo', methods=['POST'])
@login_required
@validate_csrf
def reset_logo():
    setting = db.session.get(Setting, 'logo_path')
    if setting and setting.value:
        old_file = os.path.join(current_app.root_path, current_app.config['UPLOAD_FOLDER'], setting.value)
        if os.path.exists(old_file):
            os.remove(old_file)
        setting.value = ''

    _log_audit('RESET_LOGO', {})
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Logo reset to default'})


@api_bp.route('/settings/reset-banner', methods=['POST'])
@login_required
@validate_csrf
def reset_banner():
    setting = db.session.get(Setting, 'banner_path')
    if setting and setting.value:
        old_file = os.path.join(current_app.root_path, current_app.config['UPLOAD_FOLDER'], setting.value)
        if os.path.exists(old_file):
            os.remove(old_file)
        setting.value = ''

    _log_audit('RESET_BANNER', {})
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Banner reset to default'})


@api_bp.route('/settings/reset-custom-bg', methods=['POST'])
@login_required
@validate_csrf
def reset_custom_bg():
    setting = db.session.get(Setting, 'custom_bg_path')
    if setting and setting.value:
        old_file = os.path.join(current_app.root_path, current_app.config['UPLOAD_FOLDER'], setting.value)
        if os.path.exists(old_file):
            os.remove(old_file)
        setting.value = ''

    _log_audit('RESET_CUSTOM_BG', {})
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Background image reset to default'})


# ─── Admin Utility API ────────────────────────────────────────

@api_bp.route('/admin/stats', methods=['GET'])
@login_required
def admin_stats():
    total = Session.query.count()
    by_day = db.session.query(Session.day, db.func.count(Session.id)).group_by(Session.day).all()
    by_type = db.session.query(Session.type, db.func.count(Session.id)).group_by(Session.type).all()
    cancelled = Session.query.filter_by(status='cancelled').count()
    presenters = db.session.query(db.func.count(db.distinct(Session.presenter))).filter(
        Session.presenter.isnot(None), Session.presenter != ''
    ).scalar()

    return jsonify({
        'total_sessions': total,
        'cancelled_sessions': cancelled,
        'total_presenters': presenters or 0,
        'by_day': {str(d): c for d, c in by_day},
        'by_type': {t: c for t, c in by_type},
    })


@api_bp.route('/admin/audit-log', methods=['GET'])
@login_required
def get_audit_log():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)

    pagination = AuditLog.query.order_by(AuditLog.timestamp.desc()).paginate(
        page=page, per_page=per_page, error_out=False
    )

    return jsonify({
        'logs': [log.to_dict() for log in pagination.items],
        'total': pagination.total,
        'pages': pagination.pages,
        'current_page': pagination.page,
    })


@api_bp.route('/admin/export-db-backup', methods=['GET'])
@login_required
def export_db_backup():
    db_path = os.path.join(current_app.instance_path, 'conference.db')
    if not os.path.exists(db_path):
        # Try relative path
        db_uri = current_app.config['SQLALCHEMY_DATABASE_URI']
        if db_uri.startswith('sqlite:///'):
            db_path = db_uri.replace('sqlite:///', '')
            if not os.path.isabs(db_path):
                db_path = os.path.join(current_app.root_path, db_path)

    if not os.path.exists(db_path):
        return jsonify({'status': 'error', 'message': 'Database file not found'}), 404

    _log_audit('EXPORT_DB_BACKUP', {})
    db.session.commit()

    backup_name = f'conference_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}.db'
    return send_file(db_path, as_attachment=True, download_name=backup_name)


@api_bp.route('/sessions/bulk-status', methods=['POST'])
@login_required
@validate_csrf
def bulk_status_change():
    data = request.get_json()
    if not data or 'ids' not in data or 'status' not in data:
        return jsonify({'status': 'error', 'message': 'IDs and status required'}), 400

    new_status = data['status']
    if new_status not in ALLOWED_STATUSES:
        return jsonify({'status': 'error', 'message': f'Invalid status: {new_status}'}), 400

    ids = data['ids']
    sessions = Session.query.filter(Session.id.in_(ids)).all()
    count = 0
    for s in sessions:
        s.status = new_status
        count += 1

    _log_audit('BULK_STATUS_CHANGE', {'count': count, 'ids': ids, 'new_status': new_status})
    db.session.commit()

    return jsonify({'status': 'success', 'message': f'{count} sessions updated', 'updated': count})



# ─── Web Push Notifications API ──────────────────────────────

@api_bp.route('/push/vapid-public-key', methods=['GET'])
def push_vapid_key():
    """Return the VAPID public key for client subscription."""
    key = os.environ.get('VAPID_PUBLIC_KEY', '')
    return jsonify({'public_key': key})


@api_bp.route('/push/subscribe', methods=['POST'])
def push_subscribe():
    """Subscribe a browser to push notifications."""
    push_enabled = Setting.query.get('push_enabled')
    if not push_enabled or push_enabled.value != 'true':
        return jsonify({'status': 'error', 'message': 'Push notifications disabled'}), 403

    data = request.get_json()
    if not data or 'endpoint' not in data:
        return jsonify({'status': 'error', 'message': 'Invalid subscription data'}), 400

    endpoint = data.get('endpoint', '')
    keys = data.get('keys', {})
    p256dh = keys.get('p256dh', '')
    auth = keys.get('auth', '')

    if not endpoint or not p256dh or not auth:
        return jsonify({'status': 'error', 'message': 'Missing subscription keys'}), 400

    existing = PushSubscription.query.filter_by(endpoint=endpoint).first()
    if existing:
        existing.p256dh = p256dh
        existing.auth = auth
    else:
        sub = PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth)
        db.session.add(sub)

    db.session.commit()
    return jsonify({'status': 'success', 'message': 'Subscribed'})


@api_bp.route('/push/unsubscribe', methods=['POST'])
def push_unsubscribe():
    """Remove a browser push subscription."""
    data = request.get_json()
    endpoint = data.get('endpoint', '') if data else ''
    if endpoint:
        PushSubscription.query.filter_by(endpoint=endpoint).delete()
        db.session.commit()
    return jsonify({'status': 'success', 'message': 'Unsubscribed'})


@api_bp.route('/push/stats', methods=['GET'])
@login_required
def push_stats():
    """Return push notification subscriber count."""
    count = PushSubscription.query.count()
    sent_setting = Setting.query.get('push_sent_count')
    sent_total = int(sent_setting.value) if sent_setting and sent_setting.value else 0
    return jsonify({'subscribers': count, 'sent_total': sent_total})


@api_bp.route('/push/send', methods=['POST'])
@login_required
@validate_csrf
def push_send():
    """Send a push notification to all subscribers (admin only)."""
    data = request.get_json()
    if not data or not data.get('title') or not data.get('message'):
        return jsonify({'status': 'error', 'message': 'Title and message are required'}), 400

    title = data['title'].strip()[:60]
    message = data['message'].strip()[:140]

    vapid_private = os.environ.get('VAPID_PRIVATE_KEY', '').replace('\\n', '\n')
    vapid_public = os.environ.get('VAPID_PUBLIC_KEY', '')
    vapid_subject = os.environ.get('VAPID_SUBJECT', 'mailto:admin@conference.local')

    if not vapid_private or not vapid_public:
        return jsonify({'status': 'error', 'message': 'VAPID keys not configured'}), 500

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return jsonify({'status': 'error', 'message': 'pywebpush not installed'}), 500

    subscriptions = PushSubscription.query.all()
    if not subscriptions:
        return jsonify({'status': 'ok', 'message': 'No subscribers to notify', 'sent': 0, 'failed': 0})

    payload = json.dumps({
        'title': title,
        'body': message,
        'icon': '/static/uploads/' + (Setting.query.get('logo_path').value if Setting.query.get('logo_path') and Setting.query.get('logo_path').value else ''),
        'badge': '/static/favicon.ico',
        'tag': 'conference-update',
    })

    sent = 0
    failed = 0
    expired = []

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    'endpoint': sub.endpoint,
                    'keys': {'p256dh': sub.p256dh, 'auth': sub.auth},
                },
                data=payload,
                vapid_private_key=vapid_private,
                vapid_claims={'sub': vapid_subject},
            )
            sent += 1
        except WebPushException as e:
            err_msg = str(e).lower()
            status_code = e.response.status_code if (hasattr(e, 'response') and e.response is not None) else None
            if (status_code in (400, 403, 404, 410)) or any(code in err_msg for code in ('400', '403', '404', '410', 'expired', 'not correspond')):
                # Subscription expired or VAPID key mismatched — remove from DB
                expired.append(sub.id)
            failed += 1
        except Exception:
            failed += 1

    # Clean up expired subscriptions
    if expired:
        PushSubscription.query.filter(PushSubscription.id.in_(expired)).delete(synchronize_session=False)

    # Track total sent count
    sent_setting = Setting.query.get('push_sent_count')
    total_sent = (int(sent_setting.value) if sent_setting and sent_setting.value else 0) + sent
    if sent_setting:
        sent_setting.value = str(total_sent)
    else:
        db.session.add(Setting(key='push_sent_count', value=str(total_sent)))

    _log_audit('PUSH_NOTIFICATION_SENT', {'title': title, 'sent': sent, 'failed': failed})
    db.session.commit()

    return jsonify({
        'status': 'success',
        'message': f'Sent to {sent} subscriber(s)',
        'sent': sent,
        'failed': failed,
        'expired_removed': len(expired),
    })


@api_bp.route('/sessions/wipe-all', methods=['POST'])
@login_required
@validate_csrf
def wipe_all_sessions():
    count = Session.query.count()
    Session.query.delete()
    _log_audit('WIPE_ALL_SESSIONS', {'count': count})
    db.session.commit()
    return jsonify({'status': 'success', 'message': f'{count} sessions deleted', 'deleted': count})
