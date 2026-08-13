"""
Emergency Admin Password Reset Script
Run this script to set a new admin password whenever you forget it:
    venv\\Scripts\\python reset_admin.py
"""

import sys
from app import create_app
from models import db, User
from bcrypt import hashpw, gensalt

def reset_password(new_password="admin123", username="admin"):
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(username=username).first()
        hashed = hashpw(new_password.encode('utf-8'), gensalt()).decode('utf-8')
        
        if user:
            user.password_hash = hashed
            db.session.commit()
            print(f"✅ Success: Password for user '{username}' has been reset to: {new_password}")
        else:
            new_user = User(username=username, password_hash=hashed, role='admin')
            db.session.add(new_user)
            db.session.commit()
            print(f"✅ Success: Created new admin user '{username}' with password: {new_password}")

if __name__ == "__main__":
    password = sys.argv[1] if len(sys.argv) > 1 else "admin123"
    reset_password(password)
