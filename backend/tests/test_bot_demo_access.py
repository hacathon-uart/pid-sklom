"""Offline contract tests plus opt-in SQL tests against a disposable container.

TELEGRAM_DEMO_TEST_CONTAINER=<temporary postgres container> pytest tests/test_bot_demo_access.py
The SQL fixture creates/drops its own database and never accesses website tables.
"""

import asyncio
import hashlib
import importlib
import json
import os
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from app.bot import demo_access as access


@pytest.fixture
def config(monkeypatch):
    settings = SimpleNamespace(
        telegram_allowed_ids=frozenset({42}),
        telegram_demo_invite_code="secret_invite-123",
        telegram_demo_event_id="museum-demo",
        telegram_demo_ends_at=datetime.now(UTC) + timedelta(days=1),
        telegram_demo_quota=5,
        telegram_demo_global_quota=200,
        telegram_demo_max_concurrent=4,
        supabase_url="https://store.example/",
        supabase_service_key="service-secret",
    )
    monkeypatch.setattr(access, "get_settings", lambda: settings)
    return settings


@pytest.fixture
def wire(monkeypatch):
    client_class = httpx.Client
    calls = []
    state = {"result": True, "status": 200, "error": None, "raw": None}

    def handle(request):
        calls.append((request, threading.get_ident()))
        if state["error"]:
            raise state["error"]
        if state["raw"] is not None:
            return httpx.Response(state["status"], content=state["raw"])
        return httpx.Response(state["status"], content=json.dumps(state["result"]))

    monkeypatch.setattr(access.httpx, "Client", lambda **kw: client_class(
        transport=httpx.MockTransport(handle), **kw,
    ))
    return state, calls


def run(coro):
    return asyncio.run(coro)


def test_import_has_no_settings_or_network_side_effects(monkeypatch):
    import app.config

    def forbidden(*args, **kwargs):
        raise AssertionError("Import performed I/O or loaded settings")

    with monkeypatch.context() as patch:
        patch.setattr(app.config, "get_settings", forbidden)
        patch.setattr(httpx, "Client", forbidden)
        importlib.reload(access)
    # Restore the ordinary dependency after the reload.
    importlib.reload(access)


def test_organizer_bypasses_disabled_demo_and_unavailable_store(config, wire):
    state, calls = wire
    config.telegram_demo_invite_code = ""
    config.supabase_service_key = ""
    state["error"] = httpx.ConnectError("should not connect")
    assert run(access.allowed(42)) is True
    assert run(access.begin(42, "-123:7")) == "started"
    assert run(access.finish(42, "-123:7", True)) is None
    assert calls == []


@pytest.mark.parametrize("missing", ["telegram_demo_invite_code", "telegram_demo_event_id", "telegram_demo_ends_at"])
def test_disabled_is_allowlist_only(config, wire, missing):
    setattr(config, missing, None if missing.endswith("ends_at") else "")
    assert run(access.allowed(7)) is False
    assert run(access.begin(7, "1:2")) == "closed"
    assert run(access.enroll(7, "secret_invite-123")) == "closed"
    assert wire[1] == []


@pytest.mark.parametrize("bad_code", ["wrong", "SECRET_INVITE-123", "", "секрет", None])
def test_invalid_invite_never_reaches_store(config, wire, bad_code):
    assert run(access.enroll(7, bad_code)) == "invalid"
    assert wire[1] == []


def test_service_rpc_runs_in_threadpool_without_invite_or_raw_request_id(config, wire):
    state, calls = wire
    state["result"] = "started"
    assert run(access.begin(7, "-123456:789")) == "started"
    request, worker = calls[0]
    assert worker != threading.get_ident()
    assert str(request.url) == "https://store.example/rest/v1/rpc/telegram_demo_begin"
    assert request.headers["apikey"] == config.supabase_service_key
    assert request.headers["authorization"] == f"Bearer {config.supabase_service_key}"
    payload = json.loads(request.content)
    assert payload == {
        "p_event_id": "museum-demo", "p_user_id": 7,
        "p_ends_at": config.telegram_demo_ends_at.isoformat(),
        "p_request_key": hashlib.sha256(b"-123456:789").hexdigest(),
        "p_quota": 5, "p_global_quota": 200, "p_max_concurrent": 4,
    }
    assert config.telegram_demo_invite_code not in request.content.decode()


@pytest.mark.parametrize("status", ["started", "duplicate", "limited", "busy", "closed"])
def test_begin_status_contract(config, wire, status):
    wire[0]["result"] = status
    assert run(access.begin(7, "1:2")) == status


@pytest.mark.parametrize("status", ["enrolled", "closed"])
def test_enrollment_status_contract(config, wire, status):
    wire[0]["result"] = status
    assert run(access.enroll(7, config.telegram_demo_invite_code)) == status
    assert config.telegram_demo_invite_code not in wire[1][0][0].content.decode()


@pytest.mark.parametrize("status", [True, False])
def test_allowed_uses_active_membership(config, wire, status):
    wire[0]["result"] = status
    assert run(access.allowed(7)) is status


def test_code_rotation_preserves_membership_and_rejects_old_code(config, wire):
    old = config.telegram_demo_invite_code
    config.telegram_demo_invite_code = "rotated_code"
    assert run(access.allowed(7)) is True
    assert run(access.enroll(7, old)) == "invalid"
    wire[0]["result"] = "enrolled"
    assert run(access.enroll(8, "rotated_code")) == "enrolled"


def test_finish_after_disabling_or_expiry_uses_current_event_and_is_idempotent(config, wire):
    config.telegram_demo_invite_code = ""
    config.telegram_demo_ends_at = datetime.now(UTC) - timedelta(days=1)
    wire[0]["result"] = None
    for _ in range(2):
        assert run(access.finish(7, "1:2", False)) is None
    payload = json.loads(wire[1][0][0].content)
    assert payload == {
        "p_event_id": "museum-demo", "p_user_id": 7,
        "p_request_key": hashlib.sha256(b"1:2").hexdigest(), "p_success": False,
    }


@pytest.mark.parametrize("operation", ["allowed", "enroll", "begin", "finish"])
@pytest.mark.parametrize("failure", ["network", "http", "json", "shape", "credentials"])
def test_store_errors_are_typed_fail_closed_and_redacted(config, wire, operation, failure, caplog):
    state, _ = wire
    secret = config.telegram_demo_invite_code + config.supabase_service_key
    if failure == "network":
        state["error"] = httpx.ReadTimeout(secret)
    elif failure == "http":
        state.update(status=503, result={"error": secret})
    elif failure == "json":
        state["raw"] = secret.encode()
    elif failure == "shape":
        state["result"] = {"status": "started", "secret": secret}
    else:
        config.supabase_service_key = ""
    args = {"allowed": (7,), "enroll": (7, config.telegram_demo_invite_code),
            "begin": (7, "1:2"), "finish": (7, "1:2", True)}[operation]
    with pytest.raises(access.DemoStoreUnavailable) as exc:
        run(getattr(access, operation)(*args))
    assert secret not in str(exc.value)
    assert secret not in caplog.text
    assert exc.value.__suppress_context__ or failure in ("shape", "credentials")


@pytest.mark.parametrize("value", [1, "true", None, [], {"allowed": True}])
def test_allowed_rejects_malformed_boolean(config, wire, value):
    wire[0]["result"] = value
    with pytest.raises(access.DemoStoreUnavailable):
        run(access.allowed(7))


def test_configuration_drives_limits_and_event(config, wire):
    config.telegram_demo_quota = 9
    config.telegram_demo_global_quota = 51
    config.telegram_demo_max_concurrent = 2
    config.telegram_demo_event_id = "new-event"
    wire[0]["result"] = "started"
    run(access.begin(7, "1:2"))
    payload = json.loads(wire[1][0][0].content)
    assert (payload["p_quota"], payload["p_global_quota"], payload["p_max_concurrent"]) == (9, 51, 2)
    assert payload["p_event_id"] == "new-event"


@pytest.mark.parametrize("field,value", [
    ("telegram_demo_event_id", "Upper_Case"),
    ("telegram_demo_ends_at", datetime(2030, 1, 1)),
    ("telegram_demo_quota", -1), ("telegram_demo_global_quota", True),
    ("telegram_demo_max_concurrent", 0),
])
def test_malformed_configuration_fails_closed(config, wire, field, value):
    setattr(config, field, value)
    with pytest.raises(access.DemoStoreUnavailable):
        run(access.begin(7, "1:2"))
    assert wire[1] == []


@pytest.fixture(scope="module")
def sql():
    container = os.environ.get("TELEGRAM_DEMO_TEST_CONTAINER")
    if not container:
        pytest.skip("Set TELEGRAM_DEMO_TEST_CONTAINER to an isolated PostgreSQL container")
    database = "demo_test_" + uuid.uuid4().hex

    def query(statement, db=database):
        result = subprocess.run(
            ["docker", "exec", "-i", container, "psql", "-U", "postgres", "-d", db,
             "-X", "-qAt", "-v", "ON_ERROR_STOP=1"],
            input=statement, capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()

    query(f"create database {database};", db="postgres")
    try:
        query("""do $$ begin
          if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
          if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
          if not exists (select from pg_roles where rolname = 'service_role') then
            create role service_role bypassrls;
          end if;
        end $$;""")
        migration = (Path(__file__).resolve().parents[2] / "data/migrations/0004_telegram_demo.sql").read_text()
        query(migration)
        query(migration)  # Idempotency includes grants, indexes and function signatures.
        yield query, migration
    finally:
        query(f"drop database {database} with (force);", db="postgres")


def enroll_sql(event, user):
    return f"select public.telegram_demo_enroll('{event}', now() + interval '1 day', {user});"


def begin_sql(event, user, request, quota=5, total=200, concurrent=4):
    key = hashlib.sha256(str(request).encode()).hexdigest()
    return (f"select public.telegram_demo_begin('{event}', now() + interval '1 day', {user}, "
            f"'{key}', {quota}, {total}, {concurrent});")


def finish_sql(event, user, request, success):
    key = hashlib.sha256(str(request).encode()).hexdigest()
    return f"select public.telegram_demo_finish('{event}', {user}, '{key}', {str(success).lower()});"


def test_sql_membership_fixed_expiry_event_revocation_and_rerun(sql):
    query, migration = sql
    assert query(enroll_sql("membership", 1)) == "enrolled"
    assert query(enroll_sql("membership", 1)) == "enrolled"
    query(migration)  # Rerun after enrollment must preserve it.
    assert query("select telegram_demo_allowed('membership', now() + interval '1 day', 1);") == "t"
    assert query("select telegram_demo_allowed('replacement', now() + interval '1 day', 1);") == "f"
    before = query("select ends_at from telegram_demo_events where event_id = 'membership';")
    query("select telegram_demo_enroll('membership', now() + interval '2 days', 2);")
    assert query("select ends_at from telegram_demo_events where event_id = 'membership';") == before
    query("update telegram_demo_events set ends_at = now() - interval '1 second' where event_id = 'membership';")
    assert query("select telegram_demo_allowed('membership', now() + interval '1 day', 1);") == "f"
    assert query(enroll_sql("membership", 3)) == "closed"
    assert query(begin_sql("membership", 1, "a")) == "closed"


def test_sql_dedup_busy_refund_first_finish_and_quota(sql):
    query, _ = sql
    event = "usage"
    query(enroll_sql(event, 1))
    assert query(begin_sql(event, 99, "a")) == "closed"
    assert query(begin_sql(event, 1, "a", quota=1)) == "started"
    assert query(begin_sql(event, 1, "a", quota=1)) == "duplicate"
    assert query(begin_sql(event, 1, "b", quota=1)) == "busy"
    query(finish_sql(event, 1, "a", False))
    query(finish_sql(event, 1, "a", True))  # A retry cannot change the first outcome.
    assert query(begin_sql(event, 1, "a", quota=1)) == "duplicate"
    assert query(begin_sql(event, 1, "b", quota=1)) == "started"
    query(finish_sql(event, 1, "b", True))
    query(finish_sql(event, 1, "b", False))
    assert query(begin_sql(event, 1, "c", quota=1)) == "limited"
    query(enroll_sql(event, 2))
    assert query(begin_sql(event, 2, "a", total=1)) == "limited"


def test_sql_crash_recovery_consumes_stale_and_late_finish_cannot_refund(sql):
    query, _ = sql
    event = "recovery"
    for user in (1, 2):
        query(enroll_sql(event, user))
    assert query(begin_sql(event, 1, "crashed", concurrent=1)) == "started"
    assert query(begin_sql(event, 2, "next", concurrent=1)) == "busy"
    query("update telegram_demo_requests set started_at = now() - interval '6 minutes' "
          "where event_id = 'recovery';")
    assert query(begin_sql(event, 2, "next", concurrent=1)) == "started"
    query(finish_sql(event, 1, "crashed", False))
    assert query("select state from telegram_demo_requests where event_id = 'recovery' and user_id = 1;") == "succeeded"
    assert query(begin_sql(event, 1, "crashed", concurrent=1)) == "duplicate"
    query(finish_sql(event, 2, "next", False))
    assert query(begin_sql(event, 1, "new", quota=1)) == "limited"
    assert query(begin_sql(event, 1, "new", quota=2)) == "started"


@pytest.mark.parametrize("total,cap,expected,denied", [(200, 4, 4, "busy"), (3, 10, 3, "limited")])
def test_sql_parallel_global_reservations_are_atomic(sql, total, cap, expected, denied):
    query, _ = sql
    event = f"parallel-{total}"
    for user in range(1, 9):
        query(enroll_sql(event, user))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda user: query(begin_sql(event, user, "same-message", total=total,
                                                           concurrent=cap)), range(1, 9)))
    assert results.count("started") == expected
    assert results.count(denied) == 8 - expected


def test_sql_parallel_same_request_only_starts_once(sql):
    query, _ = sql
    query(enroll_sql("duplicates", 1))
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: query(begin_sql("duplicates", 1, "one")), range(6)))
    assert results.count("started") == 1
    assert results.count("duplicate") == 5


def test_sql_only_service_role_can_access_tables_and_rpcs(sql):
    query, _ = sql
    for role in ("anon", "authenticated"):
        assert query(f"""select bool_or(has_table_privilege('{role}', oid, 'SELECT,INSERT,UPDATE,DELETE'))
          from pg_class where relname in ('telegram_demo_events', 'telegram_demo_members', 'telegram_demo_requests');
        """) == "f"
        assert query(f"""select bool_or(has_function_privilege('{role}', oid, 'EXECUTE'))
          from pg_proc where proname like 'telegram_demo_%';""") == "f"
    assert query("select bool_and(relrowsecurity) from pg_class where relname in "
                 "('telegram_demo_events', 'telegram_demo_members', 'telegram_demo_requests');") == "t"
    assert query("set role service_role; " + enroll_sql("service-role", 1)) == "enrolled"
    assert query("set role service_role; " + begin_sql("service-role", 1, "a")) == "started"
    query("set role service_role; " + finish_sql("service-role", 1, "a", True))
