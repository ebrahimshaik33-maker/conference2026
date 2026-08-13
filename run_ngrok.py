import time
import sys
from pyngrok import ngrok

token = '3HolZ3SUU9dkUAbzbm5tfmUUA9w_6ijsfkwMYxNUmgn1FxqSA'
ngrok.set_auth_token(token)

try:
    # Connect using reserved static domain
    tunnel = ngrok.connect(5000, domain="phonebook-uncloak-mug.ngrok-free.dev")
    print("\n==========================================")
    print(f"LIVE PUBLIC NGROK URL: {tunnel.public_url}")
    print("==========================================\n")
    sys.stdout.flush()
    time.sleep(86400)
except Exception as e:
    # Fallback to dynamic tunnel
    try:
        tunnel = ngrok.connect(5000)
        print("\n==========================================")
        print(f"LIVE PUBLIC NGROK URL: {tunnel.public_url}")
        print("==========================================\n")
        sys.stdout.flush()
        time.sleep(86400)
    except Exception as e2:
        print(f"Error starting tunnel: {e2}")
        sys.stdout.flush()
