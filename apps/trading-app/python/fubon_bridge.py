#!/usr/bin/env python3
"""
Bridge process between the Node.js trading-app CLI and Fubon's official
`fubon_neo` Python SDK (pip install fubon_neo).

Protocol: newline-delimited JSON on stdin/stdout.
  Node -> Python: {"id": 1, "action": "login", "params": {...}}
  Python -> Node: {"id": 1, "ok": true, "data": {...}}

Credentials arrive only via stdin from the local CLI process (never over the
network) and are held in memory only for the lifetime of this process.

NOTE: The exact class/method names below (FubonSDK, Order, BSAction, ...)
follow the shape documented in Fubon's official Neo SDK guide at the time
this bridge was written. Verify them against the current official
documentation before relying on this in production — brokerage SDKs change
their surface between releases.

Simulation ("模擬") trading: FubonSDK(url=SIMULATION_URL) points the SDK at
Fubon's simulation endpoint instead of production; login/order calls are
otherwise identical. Requires a Fubon-issued simulation account/certificate.
"""
import sys
import json
import traceback

# Fubon's simulation ("模擬") trading environment endpoint — used instead of the
# default production endpoint when the caller marks the connection as simulate.
SIMULATION_URL = "wss://neoapitest.fbs.com.tw/TASP/XCPXWS"


def emit(id_, ok, data=None, error=None):
    msg = {"id": id_, "ok": ok}
    if ok:
        msg["data"] = data
    else:
        msg["error"] = error
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    sdk = None
    account = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        req_id = req.get("id")
        action = req.get("action")
        params = req.get("params") or {}

        try:
            if action == "login":
                from fubon_neo.sdk import FubonSDK

                sdk = FubonSDK(url=SIMULATION_URL) if params.get("simulate") else FubonSDK()
                result = sdk.login(
                    params["id"],
                    params["password"],
                    params["certPath"],
                    params["certPassword"],
                )
                accounts = getattr(result, "data", result)
                account = accounts[0] if accounts else None
                if account is None:
                    raise RuntimeError("Login succeeded but no trading account was returned")
                sdk.init_realtime()
                emit(req_id, True, {"accounts": str(accounts)})

            elif action == "placeOrder":
                if sdk is None or account is None:
                    raise RuntimeError("Not logged in")
                from fubon_neo.constant import BSAction, MarketType, OrderType, PriceType, TimeInForce
                from fubon_neo.sdk import Order

                order = Order(
                    buy_sell=BSAction.Buy if params["side"] == "Buy" else BSAction.Sell,
                    symbol=params["symbol"],
                    quantity=int(params["quantity"]),
                    market_type=MarketType.Common,
                    price_type=PriceType.Market,
                    time_in_force=TimeInForce.ROD,
                    order_type=OrderType.Stock,
                )
                result = sdk.place_order(account, order)
                emit(req_id, True, {"result": str(result)})

            elif action == "logout":
                if sdk is not None:
                    sdk.logout()
                emit(req_id, True)

            else:
                emit(req_id, False, error=f"Unknown action: {action}")

        except Exception as exc:
            emit(req_id, False, error=f"{exc}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
