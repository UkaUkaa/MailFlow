"""Static architecture rules, enforced by parsing imports. See docs/architecture."""

from __future__ import annotations

import ast
from collections import defaultdict
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
LAYERS = ("domain", "application", "infrastructure", "presentation")

FRAMEWORKS = {
    "domain": {"fastapi", "starlette", "sqlalchemy", "redis", "celery", "httpx", "pydantic",
               "alembic", "nh3", "argon2", "cryptography", "structlog"},
    "application": {"fastapi", "starlette", "sqlalchemy", "redis", "celery", "httpx", "alembic",
                    "nh3", "argon2", "cryptography"},
    "infrastructure": {"fastapi", "starlette"},
}  # fmt: skip


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(), filename=str(path))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module)
    return found


def _module_name(path: Path) -> str:
    relative = path.relative_to(APP.parent).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _classify(dotted: str) -> tuple[str, str] | None:
    """Return (business module, layer) for ``app.modules.<module>.<layer>...``."""
    parts = dotted.split(".")
    if len(parts) >= 4 and parts[:2] == ["app", "modules"] and parts[3] in LAYERS:
        return parts[2], parts[3]
    return None


FILES = {_module_name(p): _imports(p) for p in APP.rglob("*.py")}


def _violations(check) -> list[str]:
    problems = []
    for name, imports in sorted(FILES.items()):
        for imported in sorted(imports):
            message = check(name, imported)
            if message:
                problems.append(f"{name} imports {imported}: {message}")
    return problems


def test_every_module_file_lives_in_a_layer():
    stray = [
        name for name in FILES
        if name.startswith("app.modules.") and len(name.split(".")) > 3 and not _classify(name)
    ]  # fmt: skip
    assert stray == []


def test_layers_do_not_import_forbidden_frameworks():
    def check(name: str, imported: str) -> str | None:
        own = _classify(name)
        if own is None:
            return None
        root = imported.split(".")[0]
        if root in FRAMEWORKS.get(own[1], set()):
            return f"{own[1]} layer must not depend on {root}"
        return None

    assert _violations(check) == []


def test_domain_and_application_are_isolated_from_infrastructure():
    def check(name: str, imported: str) -> str | None:
        own = _classify(name)
        if own is None or own[1] not in ("domain", "application"):
            return None
        if imported.startswith(("app.core", "app.infrastructure", "app.bootstrap", "app.api")):
            return f"{own[1]} layer must not depend on technical packages"
        if imported.startswith("app.integrations") and not imported.startswith(
            "app.integrations.email_providers.contracts"
        ):
            return "only the provider contract may be imported from integrations"
        target = _classify(imported)
        if target and target[1] in ("infrastructure", "presentation"):
            return f"{own[1]} must not import {target[1]}"
        if own[1] == "domain" and target and target[1] == "application":
            return "domain must not import application"
        return None

    assert _violations(check) == []


def test_modules_use_each_other_only_through_public_layers():
    def check(name: str, imported: str) -> str | None:
        own, target = _classify(name), _classify(imported)
        if own is None or target is None or own[0] == target[0]:
            return None
        if own[1] == "presentation":
            return None  # composition edge: may wire other modules' implementations
        if target[1] in ("infrastructure", "presentation"):
            return f"private layer of module '{target[0]}'"
        return None

    assert _violations(check) == []


def test_infrastructure_never_imports_presentation():
    def check(name: str, imported: str) -> str | None:
        own, target = _classify(name), _classify(imported)
        if own and target and own[1] == "infrastructure" and target[1] == "presentation":
            return "infrastructure must not import presentation"
        return None

    assert _violations(check) == []


def test_technical_packages_do_not_depend_on_business_modules():
    def check(name: str, imported: str) -> str | None:
        if name.startswith(("app.core", "app.shared")) and imported.startswith(
            ("app.modules", "app.bootstrap", "app.api")
        ):
            if name == "app.core.database.registry":
                return None  # the model registry is the documented exception
            return "core/shared must not import business modules"
        if name.startswith("app.shared") and imported.startswith(
            ("app.core", "app.infrastructure")
        ):
            return "shared must stay framework-free"
        if name.startswith("app.integrations") and imported.startswith(
            ("app.modules", "app.bootstrap", "app.api")
        ):
            return "provider adapters must not import business modules"
        return None

    assert _violations(check) == []


def test_business_modules_know_providers_only_through_the_contract():
    def check(name: str, imported: str) -> str | None:
        if not name.startswith("app.modules"):
            return None
        if imported.startswith("app.integrations.email_providers") and not imported.startswith(
            "app.integrations.email_providers.contracts"
        ):
            return "use app.integrations.email_providers.contracts"
        return None

    assert _violations(check) == []


def test_only_composition_roots_touch_celery():
    allowed = ("app.infrastructure.celery", "app.main")

    def check(name: str, imported: str) -> str | None:
        if imported.split(".")[0] == "celery" or imported.startswith("app.infrastructure.celery"):
            if not name.startswith(allowed):
                return "Celery is wired only in infrastructure and the app factory"
        return None

    assert _violations(check) == []


def test_no_dependency_cycles_between_modules():
    """Cycles are evaluated on domain/application/infrastructure (presentation is the edge)."""
    graph: dict[str, set[str]] = defaultdict(set)
    for name, imports in FILES.items():
        own = _classify(name)
        if own is None or own[1] == "presentation":
            continue
        for imported in imports:
            target = _classify(imported)
            if target and target[0] != own[0]:
                graph[own[0]].add(target[0])

    cycles: list[list[str]] = []

    def visit(node: str, path: list[str]) -> None:
        if node in path:
            cycles.append([*path[path.index(node) :], node])
            return
        for neighbour in sorted(graph.get(node, ())):
            visit(neighbour, [*path, node])

    for start in sorted(graph):
        visit(start, [])
    assert cycles == [], f"module cycles: {cycles[:3]}"


def test_celery_tasks_take_only_identifiers():
    """Task signatures must not be able to carry credentials or content."""
    tree = ast.parse((APP / "infrastructure" / "celery" / "tasks.py").read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and any(
            isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "task"
            for d in node.decorator_list
        ):
            names = [a.arg for a in node.args.args]
            assert set(names) <= {"user_id", "account_id"}, (node.name, names)


def test_mail_server_connections_are_opened_only_by_the_guarded_transport():
    """User-supplied mail hosts are reached through ``imap.transport`` alone, which runs the
    SSRF guard, dials the validated IP and verifies TLS. No other module may open such a
    connection or import the protocol libraries to do so."""
    transport = "app.integrations.email_providers.imap.transport"
    allowed_imports = {transport, "app.integrations.email_providers.imap.provider"}
    constructors = {"IMAP4", "IMAP4_SSL", "IMAP4_stream", "SMTP", "SMTP_SSL", "LMTP"}
    problems: list[str] = []
    for path in APP.rglob("*.py"):
        name = _module_name(path)
        if {"imaplib", "smtplib"} & FILES[name] and name not in allowed_imports:
            problems.append(f"{name} imports imaplib/smtplib")
        if name == transport:
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            called = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if called in constructors or called == "create_connection":
                problems.append(f"{name} calls {called}()")
    assert problems == []


def test_ssrf_bypass_switch_is_read_only_by_the_registry():
    """The test-only settings reach the transport through one place."""
    readers = [
        _module_name(path)
        for path in APP.rglob("*.py")
        if "ssrf_allow_private_networks" in path.read_text()
        or "mail_tls_ca_file" in path.read_text()
    ]
    assert sorted(readers) == ["app.core.config", "app.integrations.email_providers.registry"]
