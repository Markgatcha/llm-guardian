from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_admin_auth_required_for_keys_endpoint(client: AsyncClient) -> None:
    response = await client.get("/api/v1/keys")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_key_crud_and_bearer_auth(
    client: AsyncClient,
    admin_headers: dict[str, str],
) -> None:
    list_response = await client.get("/api/v1/keys", headers=admin_headers)
    assert list_response.status_code == 200
    assert list_response.json()["keys"]

    create_response = await client.post(
        "/api/v1/keys",
        headers=admin_headers,
        json={"name": "ops"},
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["key"].startswith("sk-guardian-")

    bearer_headers = {"Authorization": f"Bearer {created['key']}"}
    get_response = await client.get(f"/api/v1/keys/{created['id']}", headers=bearer_headers)
    assert get_response.status_code == 200
    assert "key" not in get_response.json()

    patch_response = await client.patch(
        f"/api/v1/keys/{created['id']}",
        headers=admin_headers,
        json={"is_active": False},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["is_active"] is False

    delete_response = await client.delete(f"/api/v1/keys/{created['id']}", headers=admin_headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["deleted"] is True
