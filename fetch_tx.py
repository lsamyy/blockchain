import requests
import datetime

def convert_date_to_block(date_str, api_key, base_url, closest="before"):
    try:
        try:
            dt = datetime.datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            dt = datetime.datetime.strptime(date_str, "%Y-%m-%d")
    except Exception:
        raise ValueError(
            f"Invalid date format: '{date_str}'. Expected 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS'."
        )
    
    timestamp = int(dt.timestamp())
    params = {
        "module": "block",
        "action": "getblocknobytime",
        "timestamp": timestamp,
        "closest": closest,
        "apikey": api_key,
    }
    
    response = requests.get(base_url, params=params)
    data = response.json()
    
    if data.get("status") != "1":
        raise Exception(f"Error fetching block number: {data.get('result', data)}")
    return int(data["result"])

def fetch_transactions(address, action, startblock, endblock, api_key, base_url):
    params = {
        "module": "account",
        "action": action,
        "address": address,
        "startblock": startblock,
        "endblock": endblock,
        "sort": "asc",
        "apikey": api_key,
    }
    response = requests.get(base_url, params=params)
    data = response.json()
    
    if data.get("status") != "1":
        if data.get("message", "").lower() in ["no transactions found", "0"]:
            return []
        else:
            raise Exception(f"Error fetching {action} transactions: {data.get('result', data)}")
    
    return data.get("result", [])

def get_normal_transactions(address, startblock, endblock, api_key, base_url):
    transactions = fetch_transactions(address, "txlist", startblock, endblock, api_key, base_url)
    for tx in transactions:
        tx["tx_type"] = "normal"
    return transactions

def get_erc20_transactions(address, startblock, endblock, api_key, base_url):
    transactions = fetch_transactions(address, "tokentx", startblock, endblock, api_key, base_url)
    for tx in transactions:
        tx["tx_type"] = "erc20"
    return transactions

def get_internal_transactions(address, startblock, endblock, api_key, base_url):
    transactions = fetch_transactions(address, "txlistinternal", startblock, endblock, api_key, base_url)
    for tx in transactions:
        tx["tx_type"] = "internal"
    return transactions

def get_all_transactions(address, startblock, endblock, api_key, base_url):
    return {
        "normal": get_normal_transactions(address, startblock, endblock, api_key, base_url),
        "erc20": get_erc20_transactions(address, startblock, endblock, api_key, base_url),
        "internal": get_internal_transactions(address, startblock, endblock, api_key, base_url),
    }

def get_transactions_for_period(address, start_date, end_date, network="ethereum", api_key=None):
    if network == "ethereum":
        base_url = "https://api.etherscan.io/api"
    elif network == "bsc":
        base_url = "https://api.bscscan.com/api"
    else:
        raise ValueError("Unsupported network. Choose 'ethereum' or 'bsc'.")
    if not api_key:
        raise ValueError("API key is required for the selected network.")
    
    startblock = convert_date_to_block(start_date, api_key, base_url, closest="after")
    endblock = convert_date_to_block(end_date, api_key, base_url, closest="before")
    
    transactions = get_all_transactions(address, startblock, endblock, api_key, base_url)
    return transactions

if __name__ == "__main__":
    print("=== Transaction Fetcher ===")
    wallet_address = input("Enter wallet address: ").strip()
    start_date = input("Enter start date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS): ").strip()
    end_date = input("Enter end date (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS): ").strip()
    
    print("\nFetching transactions...")
    try:
        tx_data = get_transactions_for_period(wallet_address, start_date, end_date, network="ethereum", api_key=input("Enter your API key: ").strip())
        print(f"\nFetched {len(tx_data['normal'])} normal transactions.")
        print(f"Fetched {len(tx_data['erc20'])} ERC20 transactions.")
        print(f"Fetched {len(tx_data['internal'])} internal transactions.")
    except Exception as e:
        print(f"An error occurred: {e}")
