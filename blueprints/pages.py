from flask import Blueprint, render_template, redirect, url_for, session as flask_session, send_from_directory
from flask_login import login_required, current_user
import os
import secrets

from models import Setting, db
from blueprints.auth import password_change_required

pages_bp = Blueprint('pages', __name__)


def _get_csrf_token():
    if '_csrf_token' not in flask_session:
        flask_session['_csrf_token'] = secrets.token_hex(32)
    return flask_session['_csrf_token']


@pages_bp.route('/sw.js')
def service_worker():
    """Serve the service worker from root scope (required for Push API)."""
    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static')
    response = send_from_directory(static_dir, 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    response.headers['Content-Type'] = 'application/javascript'
    response.headers['Cache-Control'] = 'no-cache'
    return response


@pages_bp.route('/favicon.ico')
def favicon():
    """Serve favicon or logo, returning 204 No Content if missing to prevent 404s."""
    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static')
    fav = os.path.join(static_dir, 'favicon.ico')
    if os.path.exists(fav):
        return send_from_directory(static_dir, 'favicon.ico', mimetype='image/vnd.microsoft.icon')
    logo_setting = db.session.get(Setting, 'logo_path')
    if logo_setting and logo_setting.value:
        uploads_dir = os.path.join(static_dir, 'uploads')
        logo_file = os.path.join(uploads_dir, logo_setting.value)
        if os.path.exists(logo_file):
            return send_from_directory(uploads_dir, logo_setting.value)
    return ('', 204)


@pages_bp.route('/')
@pages_bp.route('/landing')
@pages_bp.route('/conference-corner')
def landing():
    return render_template('landing.html')


@pages_bp.route('/programme')
@pages_bp.route('/schedule')
@pages_bp.route('/app')
@pages_bp.route('/event')
@pages_bp.route('/demo')
def index():
    settings = {s.key: s.value for s in Setting.query.all()}
    return render_template('index.html', settings=settings)


@pages_bp.route('/admin')
@login_required
@password_change_required
def admin_redirect():
    return redirect(url_for('pages.admin_dashboard'))


@pages_bp.route('/admin/dashboard')
@login_required
@password_change_required
def admin_dashboard():
    settings = {s.key: s.value for s in Setting.query.all()}
    return render_template('admin/dashboard.html', settings=settings, csrf_token=_get_csrf_token())


@pages_bp.route('/admin/sessions')
@login_required
@password_change_required
def admin_sessions():
    settings = {s.key: s.value for s in Setting.query.all()}
    return render_template('admin/sessions.html', settings=settings, csrf_token=_get_csrf_token())


@pages_bp.route('/admin/settings')
@login_required
@password_change_required
def admin_settings():
    settings = {s.key: s.value for s in Setting.query.all()}
    return render_template('admin/settings.html', settings=settings, csrf_token=_get_csrf_token())


@pages_bp.route('/admin/import-export')
@login_required
@password_change_required
def admin_import_export():
    settings = {s.key: s.value for s in Setting.query.all()}
    return render_template('admin/import_export.html', settings=settings, csrf_token=_get_csrf_token())


@pages_bp.route('/admin/audit-log')
@login_required
@password_change_required
def admin_audit_log():
    settings = {s.key: s.value for s in Setting.query.all()}
    return render_template('admin/audit_log.html', settings=settings, csrf_token=_get_csrf_token())
