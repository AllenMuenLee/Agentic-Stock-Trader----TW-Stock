#!/usr/bin/env python3
"""
Bridge process between the Node.js trading-app CLI and Fubon's official
`fubon_neo` Python SDK (pip install fubon_neo).

Protocol: newline-delimited JSON on stdin/stdout.
  Node -> Python: {"id": 1, "action": "login", "params": {...}}
  Python -> Node: {"id": 1, "ok": true, "data": {...}}

Credentials arrive only via stdin from the local CLI process (never over the
network) and are held in memory only for the lifetime of this process.

NOTE: The class/method names below (FubonSDK, Order, BSAction, MarketType,
PriceType, TimeInForce, OrderType, sdk.stock.place_order,
sdk.accounting.{inventories,bank_remain}) have been checked against the
locally installed fubon_neo package via `help()`/`dir()` — including that
`place_order` lives on `sdk.stock`, not `sdk` directly (a real bug this
file had), and that MarketType/PriceType/TimeInForce all have the members
used below. Still worth re-checking after any fubon_neo version bump, since
brokerage SDKs change their surface between releases — but this isn't
speculative "written from general knowledge" any more.

NOTE (accounting calls, observed to panic): `sdk.accounting.bank_remain()`
and `sdk.accounting.inventories()` have both been observed to raise
`pyo3_runtime.PanicException` (a Rust-side panic surfaced through pyo3) for
reasons not fully understood — an internal `unwrap()` on `None`, and once
that's happened once, a poisoned-mutex panic on every subsequent accounting
call for the rest of this process's life. Every action's handler below
catches `BaseException` (not just `Exception`) specifically so this doesn't
take down the whole bridge — but the account-sync data will stay stale/
unavailable until the trading-app is restarted once this starts happening.

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

                MARKET_TYPE_MAP = {
                    "Common": MarketType.Common,   # 整股
                    "Odd": MarketType.Odd,         # 零股（盤中／盤後零股皆用此值，交易所依送單時間自動歸類）
                    "Fixing": MarketType.Fixing,    # 盤後定價
                }
                PRICE_TYPE_MAP = {
                    "Limit": PriceType.Limit,
                    "Market": PriceType.Market,
                }
                TIME_IN_FORCE_MAP = {
                    "ROD": TimeInForce.ROD,
                    "IOC": TimeInForce.IOC,
                    "FOK": TimeInForce.FOK,
                }

                market_type_key = params.get("marketType", "Common")
                price_type_key = params.get("priceType", "Market")
                time_in_force_key = params.get("timeInForce", "ROD")
                if market_type_key not in MARKET_TYPE_MAP:
                    raise RuntimeError(f"Unknown marketType: {market_type_key}")
                if price_type_key not in PRICE_TYPE_MAP:
                    raise RuntimeError(f"Unknown priceType: {price_type_key}")
                if time_in_force_key not in TIME_IN_FORCE_MAP:
                    raise RuntimeError(f"Unknown timeInForce: {time_in_force_key}")

                order_kwargs = dict(
                    buy_sell=BSAction.Buy if params["side"] == "Buy" else BSAction.Sell,
                    symbol=params["symbol"],
                    quantity=int(params["quantity"]),
                    market_type=MARKET_TYPE_MAP[market_type_key],
                    price_type=PRICE_TYPE_MAP[price_type_key],
                    time_in_force=TIME_IN_FORCE_MAP[time_in_force_key],
                    order_type=OrderType.Stock,
                )
                limit_price = params.get("limitPrice")
                if price_type_key == "Limit" and limit_price is not None:
                    order_kwargs["price"] = float(limit_price)

                order = Order(**order_kwargs)
                result = sdk.stock.place_order(account, order)
                emit(req_id, True, {"result": str(result)})

            elif action == "getAccount":
                # NOTE (same caveat as placeOrder above): the exact accounting API
                # shape (sdk.accounting.inventories / bank_remain, and the field
                # names read off their results below) follows Fubon's Neo SDK guide
                # at the time this bridge was written but has NOT been verified
                # against live docs or a real account — check before real-money use.
                if sdk is None or account is None:
                    raise RuntimeError("Not logged in")

                inventories = sdk.accounting.inventories(account)
                inv_data = getattr(inventories, "data", inventories) or []
                positions = [
                    {
                        "symbol": getattr(p, "stock_no", None) or getattr(p, "symbol", None),
                        "quantity": int(getattr(p, "today_qty", None) or getattr(p, "tradable_qty", None) or 0),
                    }
                    for p in inv_data
                ]

                balance = sdk.accounting.bank_remain(account)
                bal_data = getattr(balance, "data", balance)
                cash = float(getattr(bal_data, "balance", None) or getattr(bal_data, "available_balance", None) or 0)

                emit(req_id, True, {"cash": cash, "positions": positions})

            elif action == "logout":
                if sdk is not None:
                    sdk.logout()
                emit(req_id, True)

            else:
                emit(req_id, False, error=f"Unknown action: {action}")

        except (KeyboardInterrupt, SystemExit):
            raise
        except BaseException as exc:
            # Broader than `except Exception` on purpose: fubon_neo is a pyo3
            # wrapper over a closed-source Rust extension, and a Rust-side
            # panic (e.g. an internal `unwrap()` on None) surfaces as
            # `pyo3_runtime.PanicException`, which pyo3 deliberately makes a
            # BaseException subclass so it isn't swallowed by `except
            # Exception`. Left uncaught, it kills this loop and orphans the
            # Node side's pending request forever (see fubon-client.ts) — so
            # every action's failure, panic or not, gets turned into a normal
            # error reply instead of taking down the whole bridge process.
            emit(req_id, False, error=f"{exc}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
