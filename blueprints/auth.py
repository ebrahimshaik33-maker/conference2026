import time
import secrets
from functools import wraps
from flask import Blueprint, request, render_template, redirect, url_for, flash, session as flask_session, jsonify
from flask_login import login_user, logout_user, login_required, current_user
import bcrypt

from models import db, User, Setting, AuditLog

auth_bp = Blueprint('auth', __name__)

# In-memory rate limiting store: {ip: {'count': int, 'locked_until': float}}
_login_attempts = {}
RATE_LIMIT_MAX = 5
RATE_LIMIT_WINDOW = 900  # 15 minutes in seconds


def _check_rate_limit(ip):
    """Check if IP is rate-limited. Returns (is_blocked, remaining_seconds)."""
    now = time.time()
    if ip in _login_attempts:
        entry = _login_attempts[ip]
        if entry.get('locked_until') and now < entry['locked_until']:
            remaining = int(entry['locked_until'] - now)
            return True, remaining
        if entry.get('locked_until') and now >= entry['locked_until']:
            del _login_attempts[ip]
    return False, 0


def _record_failed_attempt(ip):
    """Record a failed login attempt and lock if threshold reached."""
    now = time.time()
    if ip not in _login_attempts:
        _login_attempts[ip] = {'count': 0, 'first_attempt': now}

    entry = _login_attempts[ip]

    # Reset counter if outside the window
    if now - entry.get('first_attempt', now) > RATE_LIMIT_WINDOW:
        entry['count'] = 0
        entry['first_attempt'] = now

    entry['count'] += 1

    if entry['count'] >= RATE_LIMIT_MAX:
        entry['locked_until'] = now + RATE_LIMIT_WINDOW


def _clear_attempts(ip):
    """Clear rate limit on successful login."""
    _login_attempts.pop(ip, None)


def generate_csrf_token():
    """Generate or return existing CSRF token."""
    if '_csrf_token' not in flask_session:
        flask_session['_csrf_token'] = secrets.token_hex(32)
    return flask_session['_csrf_token']


def validate_csrf(f):
    """Decorator to validate CSRF token on POST/PUT/DELETE requests."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if request.method in ('POST', 'PUT', 'DELETE'):
            token = request.headers.get('X-CSRF-Token') or request.form.get('_csrf_token')
            if not token or token != flask_session.get('_csrf_token'):
                return jsonify({'status': 'error', 'message': 'Invalid CSRF token'}), 403
        return f(*args, **kwargs)
    return decorated


def password_change_required(f):
    """Decorator to check if admin needs to change default password."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if current_user.is_authenticated:
            setting = db.session.get(Setting, 'admin_password_changed')
            if setting and setting.value == 'false':
                if request.endpoint not in ('auth.change_password', 'auth.logout', 'static'):
                    return redirect(url_for('auth.change_password'))
        return f(*args, **kwargs)
    return decorated


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('pages.admin_dashboard'))

    if request.method == 'POST':
        ip = request.remote_addr
        is_blocked, remaining = _check_rate_limit(ip)
        if is_blocked:
            if request.is_json:
                return jsonify({
                    'status': 'error',
                    'message': f'Too many failed attempts. Try again in {remaining} seconds.'
                }), 429
            flash(f'Too many failed attempts. Try again in {remaining // 60 + 1} minutes.', 'error')
            return render_template('auth/login.html', csrf_token=generate_csrf_token())

        # Get credentials from JSON or form
        if request.is_json:
            data = request.get_json()
            username = data.get('username', '').strip()
            password = data.get('password', '')
        else:
            username = request.form.get('username', '').strip()
            password = request.form.get('password', '')

        # Validate CSRF for form submissions
        if not request.is_json:
            token = request.form.get('_csrf_token')
            if not token or token != flask_session.get('_csrf_token'):
                flash('Invalid form submission. Please try again.', 'error')
                return render_template('auth/login.html', csrf_token=generate_csrf_token())

        user = User.query.filter_by(username=username).first()

        if user and bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
            _clear_attempts(ip)
            login_user(user)

            # Log the login
            db.session.add(AuditLog(
                user_id=user.id,
                action='LOGIN',
                detail=f'User {user.username} logged in from {ip}'
            ))
            db.session.commit()

            if request.is_json:
                return jsonify({'status': 'success', 'message': 'Logged in successfully'})

            next_page = request.args.get('next')
            return redirect(next_page or url_for('pages.admin_dashboard'))
        else:
            _record_failed_attempt(ip)
            if request.is_json:
                return jsonify({'status': 'error', 'message': 'Invalid username or password'}), 401
            flash('Invalid username or password.', 'error')

    return render_template('auth/login.html', csrf_token=generate_csrf_token())


@auth_bp.route('/logout')
@login_required
def logout():
    db.session.add(AuditLog(
        user_id=current_user.id,
        action='LOGOUT',
        detail=f'User {current_user.username} logged out'
    ))
    db.session.commit()
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('auth.login'))


@auth_bp.route('/change-password', methods=['GET', 'POST'])
@login_required
def change_password():
    if request.method == 'POST':
        if request.is_json:
            data = request.get_json()
            current_password = data.get('current_password', '')
            new_password = data.get('new_password', '')
            confirm_password = data.get('confirm_password', '')
        else:
            token = request.form.get('_csrf_token')
            if not token or token != flask_session.get('_csrf_token'):
                flash('Invalid form submission.', 'error')
                return render_template('auth/login.html', change_password=True, csrf_token=generate_csrf_token())
            current_password = request.form.get('current_password', '')
            new_password = request.form.get('new_password', '')
            confirm_password = request.form.get('confirm_password', '')

        # Validate current password
        if not bcrypt.checkpw(current_password.encode('utf-8'), current_user.password_hash.encode('utf-8')):
            msg = 'Current password is incorrect.'
            if request.is_json:
                return jsonify({'status': 'error', 'message': msg}), 400
            flash(msg, 'error')
            return render_template('auth/login.html', change_password=True, csrf_token=generate_csrf_token())

        # Validate new password
        if len(new_password) < 6:
            msg = 'New password must be at least 6 characters.'
            if request.is_json:
                return jsonify({'status': 'error', 'message': msg}), 400
            flash(msg, 'error')
            return render_template('auth/login.html', change_password=True, csrf_token=generate_csrf_token())

        if new_password != confirm_password:
            msg = 'Passwords do not match.'
            if request.is_json:
                return jsonify({'status': 'error', 'message': msg}), 400
            flash(msg, 'error')
            return render_template('auth/login.html', change_password=True, csrf_token=generate_csrf_token())

        # Update password
        current_user.password_hash = bcrypt.hashpw(
            new_password.encode('utf-8'), bcrypt.gensalt(rounds=12)
        ).decode('utf-8')

        # Mark password as changed
        setting = db.session.get(Setting, 'admin_password_changed')
        if setting:
            setting.value = 'true'

        db.session.add(AuditLog(
            user_id=current_user.id,
            action='CHANGE_PASSWORD',
            detail=f'User {current_user.username} changed their password'
        ))
        db.session.commit()

        if request.is_json:
            return jsonify({'status': 'success', 'message': 'Password changed successfully'})

        flash('Password changed successfully!', 'success')
        return redirect(url_for('pages.admin_dashboard'))

    return render_template('auth/login.html', change_password=True, csrf_token=generate_csrf_token())
