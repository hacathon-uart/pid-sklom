#!/usr/bin/env python3
"""Exercise production quota SQL on disposable Postgres, never a configured Supabase project."""

import concurrent.futures
import json
from pathlib import Path
import secrets
import subprocess
import time
import uuid


def main():
    name = f"pidsklom-auth-sql-{uuid.uuid4().hex[:12]}"

    def sql(statement):
        return subprocess.check_output(
            ["docker", "exec", "-i", name, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
            input=statement, text=True, stderr=subprocess.STDOUT,
        ).strip()

    def begin(actor, request_id=None, kind="match", digest="same", limited=True):
        request_id = request_id or str(uuid.uuid4())
        result = sql(
            f"select operation_begin('{actor}', '{request_id}', '{kind}', '{digest}', {str(limited).lower()});"
        )
        return request_id, json.loads(result)

    def finish(actor, request_id, lease, success=True):
        return sql(
            f"""select operation_finish('{actor}', '{request_id}', '{lease}', '{{"ok":true}}', {str(success).lower()});"""
        )

    subprocess.run([
        "docker", "run", "--detach", "--rm", "--name", name,
        "-e", f"POSTGRES_PASSWORD={secrets.token_urlsafe(32)}", "postgres:17-alpine",
    ], check=True, stdout=subprocess.DEVNULL)
    try:
        for _ in range(60):
            probe = subprocess.run(
                ["docker", "exec", name, "pg_isready", "-U", "postgres"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            if probe.returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable Postgres did not become ready")
        sql("create role anon; create role authenticated; create role service_role;")
        migration = Path(__file__).resolve().parents[1] / "data/migrations/0001_auth_operations.sql"
        sql(migration.read_text())
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            attempts = list(pool.map(lambda _: begin("guest:concurrent"), range(10)))
        admitted = [(key, result) for key, result in attempts if result["status"] == "started"]
        assert len(admitted) == 3, attempts
        assert sum(result["status"] == "limited" for _, result in attempts) == 7
        key, result = admitted[0]
        assert begin("guest:concurrent", key)[1]["status"] == "pending"
        assert begin("guest:concurrent", key, digest="changed")[1]["status"] == "conflict"
        assert finish("guest:concurrent", key, result["lease"]) == "t"
        assert begin("guest:concurrent", key)[1] == {"status": "complete", "response": {"ok": True}}
        key, result = admitted[1]
        assert finish("guest:concurrent", key, result["lease"], False) == "t"
        assert sql("select operation_remaining('guest:concurrent');") == "1"
        assert begin("guest:concurrent", key, kind="captions")[1]["status"] == "conflict"
        retry = begin("guest:concurrent", key)[1]
        assert retry["status"] == "started" and retry["lease"] != result["lease"]
        assert finish("guest:concurrent", key, result["lease"]) == "f"
        sql(f"update app_operations set lease_until=now()-interval '1 second' where request_id='{key}';")
        assert sql("select operation_remaining('guest:concurrent');") == "1"
        assert finish("guest:concurrent", key, retry["lease"]) == "f"
        assert begin("guest:concurrent", key)[1]["status"] == "started"
        assert begin("user:account", limited=False)[1]["status"] == "started"
        assert begin("guest:concurrent", kind="save", limited=False)[1]["status"] == "started"
        assert sql("select operation_remaining('guest:concurrent');") == "0"
        for role in ("anon", "authenticated"):
            assert sql(f"select has_function_privilege('{role}', 'operation_begin(text,uuid,text,text,boolean)', 'execute');") == "f"
            assert sql(f"select has_table_privilege('{role}', 'app_operations', 'select');") == "f"
        print("PASS: atomic three-slot quota, replay, payload conflict, failure/expiry recovery, fencing and RPC privileges")
        migration = migration.with_name("0002_guest_exports.sql")
        sql(migration.read_text())
        assert sql("select operation_remaining('guest:concurrent');") == "0"
        assert sql("select export_remaining('guest:concurrent');") == "3"
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            exports = list(pool.map(
                lambda index: begin("guest:concurrent", kind="export", digest=f"export-{index}"), range(10),
            ))
        admitted = [(key, result) for key, result in exports if result["status"] == "started"]
        assert len(admitted) == 3
        assert sum(result["status"] == "limited" for _, result in exports) == 7
        for key, result in admitted:
            assert finish("guest:concurrent", key, result["lease"]) == "t"
        assert sql("select export_remaining('guest:concurrent');") == "0"
        assert sql("select operation_remaining('guest:concurrent');") == "0"
        assert begin("guest:concurrent", admitted[0][0], kind="export", digest="export-" + str(
            next(index for index, (key, _) in enumerate(exports) if key == admitted[0][0])
        ))[1]["status"] == "complete"
        key, result = begin("guest:export-cancel", kind="export")
        assert finish("guest:export-cancel", key, result["lease"], False) == "t"
        assert sql("select export_remaining('guest:export-cancel');") == "3"
        retry = begin("guest:export-cancel", key, kind="export")[1]
        assert finish("guest:export-cancel", key, result["lease"]) == "f"
        sql(f"update app_operations set lease_until=now()-interval '1 second' where request_id='{key}';")
        assert sql("select export_remaining('guest:export-cancel');") == "3"
        assert finish("guest:export-cancel", key, retry["lease"]) == "f"
        shared = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
            repeats = list(pool.map(lambda _: begin("guest:same-png", shared, kind="export"), range(10)))
        assert sum(result["status"] == "started" for _, result in repeats) == 1
        assert sum(result["status"] == "pending" for _, result in repeats) == 9
        active = next(result for _, result in repeats if result["status"] == "started")
        assert finish("guest:same-png", shared, active["lease"]) == "t"
        assert begin("guest:same-png", shared, kind="export")[1]["status"] == "complete"
        assert sql("select export_remaining('guest:same-png');") == "2"
        assert sql("select operation_remaining('guest:same-png');") == "3"
        for role in ("anon", "authenticated"):
            assert sql(f"select has_function_privilege('{role}', 'export_remaining(text)', 'execute');") == "f"
        print("PASS: additive export migration, independent atomic quota, identical-export deduplication, cancellation, expiry and grants")
    finally:
        subprocess.run(["docker", "rm", "--force", name], check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
