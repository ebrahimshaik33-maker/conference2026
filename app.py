import os
import logging
from logging.handlers import RotatingFileHandler
from flask import Flask, jsonify, render_template
from flask_login import LoginManager
import bcrypt

from config import DevelopmentConfig, ProductionConfig
from models import db, User, Setting


login_manager = LoginManager()
login_manager.login_view = 'auth.login'
login_manager.login_message = 'Please log in to access this page.'
login_manager.login_message_category = 'warning'


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def seed_defaults():
    """Insert default admin user and settings if they don't exist."""
    # Create uploads directory
    upload_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads')
    os.makedirs(upload_dir, exist_ok=True)

    # Seed default admin user
    if not User.query.first():
        password = os.getenv('ADMIN_PASSWORD', 'admin123')
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt(rounds=12))
        admin = User(
            username=os.getenv('ADMIN_USERNAME', 'admin'),
            password_hash=password_hash.decode('utf-8'),
            role='superadmin'
        )
        db.session.add(admin)
        db.session.commit()

    # Seed default settings
    if not Setting.query.first():
        defaults = {
            'event_title': 'LTRIE Conference',
            'event_subtitle': 'Learning, Teaching, Research, Innovation & Engagement',
            'event_description': 'The official digital programme for the LTRIE academic conference.',
            'event_start_date': '2026-01-15',
            'event_days': '4',
            'logo_path': '',
            'banner_path': '',
            'favicon_path': '',
            'theme': 'theme-dut-dark',
            'show_track_filter': 'true',
            'show_evaluation_links': 'true',
            'announcement': '',
            'announcement_type': 'info',
            'admin_password_changed': 'false',
            'layout': 'timeline',
            'ui_style': 'glass',
            'footer_text': '',
            'show_top_banner': 'true',
            'show_footer_banner': 'true',
        }
        for key, value in defaults.items():
            db.session.add(Setting(key=key, value=value))
        db.session.commit()


def create_app(config=None):
    app = Flask(__name__)

    # Load configuration
    env = os.getenv('FLASK_ENV', 'development')
    if config:
        app.config.from_object(config)
    elif env == 'production':
        app.config.from_object(ProductionConfig)
    else:
        app.config.from_object(DevelopmentConfig)

    # Initialize extensions
    db.init_app(app)
    login_manager.init_app(app)

    # Initialize database
    with app.app_context():
        db.create_all()
        # Auto-migrate session columns if missing in existing SQLite database
        try:
            from sqlalchemy import text
            with db.engine.connect() as conn:
                result = conn.execute(text("PRAGMA table_info(sessions)"))
                columns = [row[1] for row in result]
                if 'meeting_url' not in columns:
                    conn.execute(text("ALTER TABLE sessions ADD COLUMN meeting_url VARCHAR(500)"))
                    conn.commit()
        except Exception as e:
            app.logger.warning(f"Session column auto-migration notice: {e}")
        seed_defaults()

    # Register blueprints
    from blueprints.auth import auth_bp
    from blueprints.api import api_bp
    from blueprints.pages import pages_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp, url_prefix='/api')
    app.register_blueprint(pages_bp)

    # Setup logging
    if not app.debug:
        file_handler = RotatingFileHandler('app.log', maxBytes=1024 * 1024, backupCount=5)
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
        ))
        file_handler.setLevel(logging.WARNING)
        app.logger.addHandler(file_handler)

    # Global error handlers
    @app.errorhandler(404)
    def not_found(e):
        from flask import request
        if request.path.startswith('/api/'):
            return jsonify({'status': 'error', 'message': 'Not found'}), 404
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def internal_error(e):
        from flask import request
        db.session.rollback()
        app.logger.error(f'Internal error: {e}')
        if request.path.startswith('/api/'):
            return jsonify({'status': 'error', 'message': 'Internal server error'}), 500
        return render_template('errors/500.html'), 500

    @app.errorhandler(413)
    def too_large(e):
        return jsonify({'status': 'error', 'message': 'File too large. Maximum size is 5MB.'}), 413

    # Context processor to inject settings into all templates
    @app.context_processor
    def inject_settings():
        try:
            return {'settings': Setting.get_settings_dict()}
        except Exception:
            return {'settings': {}}

    # CSRF token injection
    @app.after_request
    def set_csrf_cookie(response):
        from flask import session as flask_session
        import secrets
        if '_csrf_token' not in flask_session:
            flask_session['_csrf_token'] = secrets.token_hex(32)
        return response

    return app


if __name__ == '__main__':
    app = create_app()
    app.run(host='0.0.0.0', port=5000, debug=False)
