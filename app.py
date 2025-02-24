# app.py
import hashlib
from flask import Flask, request, jsonify, render_template
import fetch_tx  # This is your tx_fetcher module (saved as fetch_tx.py)

app = Flask(__name__)

@app.route("/")
def index():
    # Render the main page.
    return render_template("index.html")

@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    """
    Expects query parameters:
      - wallet_address: wallet address to analyze
      - start_date: overall start date
      - end_date: overall end date
      - network: "ethereum" or "bsc"
      - api_key: (if not using personal keys)
      - access_password: (optional) password to unlock personal keys
    """
    wallet_address = request.args.get("wallet_address")
    start_date = request.args.get("start_date")
    end_date = request.args.get("end_date")
    network = request.args.get("network", "ethereum").lower()
    user_api_key = request.args.get("api_key")
    access_password = request.args.get("access_password")

    # Ensure required parameters are provided
    if not wallet_address or not start_date or not end_date:
        return jsonify({"error": "Missing required parameters"}), 400

    elif not user_api_key:
        return jsonify({"error": "API key is required"}), 400


    try:
        # Pass network and api_key to the tx-fetcher module.
        tx_data = fetch_tx.get_transactions_for_period(
            wallet_address, start_date, end_date, network=network, api_key=user_api_key
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify(tx_data)



if __name__ == "__main__":
    app.run(debug=True)
