"""本命星盘：取盘时存下基本星盘（12 宫落座）并放进 <用户资料>、出生资料一改就删、
取星盘工具照旧每次调接口返回详细星盘；以及游客笔记本清理脚本。

全程 mock 星盘 API 与存储，不发真实请求、不碰 backend/data/。
"""
import asyncio
import sqlite3
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from models import User, UserProfile, UserType  # noqa: E402
from services.astrology_service import AstrologyService  # noqa: E402
from services.storage_service import StorageService  # noqa: E402
from services.user_service import UserService  # noqa: E402
# 导入时会建 asyncio.Lock（Python 3.9 要求当时有事件循环），必须在任何 asyncio.run 之前
from services.turn_service import _fetch_chart  # noqa: E402

CHART_TEXT = "第1宫：金牛座｜上升（金牛座）\n第11宫：水瓶座｜太阳（双鱼座）"
DETAIL_TEXT = "【星盘基本信息】\n出生地点：上海\n\n【行星落座】\n太阳：落在双鱼座 21°43' (第11宫)"


def _profile(**overrides):
    fields = dict(nickname="小夏", birth_year=1996, birth_month=3, birth_day=12,
                  birth_hour=8, birth_minute=30, birth_city="上海")
    fields.update(overrides)
    return UserProfile(**fields)


def _user(profile=None, chart=None):
    return User(user_id="user_1", user_type=UserType.REGISTERED,
                profile=profile if profile is not None else _profile(), natal_chart=chart)


def test_chart_tool_always_returns_detailed_chart_from_api():
    """存了基本星盘也照样调接口，返回详细星盘；已经存过就不再重复写库。"""
    with patch.object(AstrologyService, "fetch_natal_chart", AsyncMock(return_value={"planet": []})) as fetch, \
         patch.object(AstrologyService, "format_chart_data_to_text", return_value=DETAIL_TEXT), \
         patch("services.turn_service.StorageService.save_user", AsyncMock()) as save:
        result = asyncio.run(_fetch_chart(_user(chart=CHART_TEXT)))
    fetch.assert_awaited_once()
    save.assert_not_called()
    assert result == {"success": True, "data": DETAIL_TEXT}


def test_first_chart_fetch_saves_basic_chart_to_latest_user_record():
    user, latest = _user(), _user()
    with patch.object(AstrologyService, "fetch_natal_chart", AsyncMock(return_value={"planet": []})), \
         patch.object(AstrologyService, "format_chart_data_to_text", return_value=DETAIL_TEXT), \
         patch.object(AstrologyService, "format_chart_houses", return_value=CHART_TEXT), \
         patch("services.turn_service.StorageService.get_user", AsyncMock(return_value=latest)), \
         patch("services.turn_service.StorageService.save_user", AsyncMock()) as save:
        result = asyncio.run(_fetch_chart(user))

    save.assert_awaited_once_with(latest)
    assert latest.natal_chart == CHART_TEXT and user.natal_chart == CHART_TEXT
    assert result == {"success": True, "data": DETAIL_TEXT}   # 交给占卜师的仍是详细星盘


def test_chart_tool_saves_nothing_when_it_cannot_chart():
    with patch.object(AstrologyService, "fetch_natal_chart", AsyncMock(return_value=None)), \
         patch("services.turn_service.StorageService.save_user", AsyncMock()) as save:
        no_profile = asyncio.run(_fetch_chart(User(user_id="u", user_type=UserType.REGISTERED)))
        missing = asyncio.run(_fetch_chart(_user(profile=_profile(birth_hour=None, birth_city=None))))
        api_down = asyncio.run(_fetch_chart(_user()))

    assert no_profile == {"success": False, "error": "用户尚未提供任何个人信息"}
    assert missing == {"success": False, "error": "用户的出生信息不完整",
                       "missing_fields": ["birth_time", "birth_city"]}
    assert api_down == {"success": False, "error": "获取星盘数据失败，请稍后重试"}
    save.assert_not_called()


def test_chart_text_is_twelve_houses_with_bodies_and_their_own_signs():
    """每宫一行：宫的星座｜宫里的星体（星体自己的星座）。宫头水瓶、太阳双鱼这种不一致要写得出来。"""
    def house(n, sign):
        return {"house_id": n, "sign": {"sign_chinese": sign}}

    def body(name, sign, n):
        return {"planet_chinese": name, "house_id": n, "sign": {"sign_chinese": sign}}

    signs = ["金牛", "双子", "巨蟹", "巨蟹", "狮子", "天秤", "天蝎", "射手", "摩羯", "摩羯", "水瓶", "白羊"]
    data = {
        "house": [house(n, signs[n - 1]) for n in range(12, 0, -1)],   # 接口顺序不保证
        "planet": [body("太阳", "双鱼", 11), body("火星", "双鱼", 11), body("上升", "金牛", 1)],
    }
    lines = AstrologyService.format_chart_houses(data).splitlines()
    assert lines[0] == AstrologyService.HOUSES_LEGEND
    assert lines[1:] == [
        "第1宫：金牛座｜上升（金牛座）", "第2宫：双子座", "第3宫：巨蟹座", "第4宫：巨蟹座",
        "第5宫：狮子座", "第6宫：天秤座", "第7宫：天蝎座", "第8宫：射手座", "第9宫：摩羯座",
        "第10宫：摩羯座", "第11宫：水瓶座｜太阳（双鱼座）、火星（双鱼座）", "第12宫：白羊座",
    ]


def test_chart_request_uses_alcabitius_houses(monkeypatch):
    sent = {}

    class _Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {"code": 0, "data": {"planet": [], "house": [], "planet_xs": [], "virtual": []}}

    class _Client:
        def __init__(self, **_):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def post(self, url, json):
            sent.update(json)
            return _Response()

    monkeypatch.setattr("services.astrology_service.httpx.AsyncClient", _Client)
    asyncio.run(AstrologyService.fetch_natal_chart(
        birth_year=1996, birth_month=3, birth_day=12, birth_hour=8, birth_minute=30, city="上海"))
    assert sent["h_sys"] == "B"


def test_changing_birth_info_deletes_saved_chart():
    def update(old_profile, new_profile):
        stored = _user(profile=old_profile, chart=CHART_TEXT)
        with patch("services.user_service.StorageService.get_user", AsyncMock(return_value=stored)), \
             patch("services.user_service.StorageService.save_user", AsyncMock()) as save:
            user = asyncio.run(UserService.update_user_profile("user_1", new_profile))
        save.assert_awaited_once_with(stored)
        return user.natal_chart

    assert update(_profile(), _profile(birth_hour=9)) is None
    assert update(_profile(), _profile(birth_city="北京")) is None
    assert update(_profile(), _profile(birth_city=None)) is None
    assert update(_profile(), _profile(nickname="夏夏", gender="female")) == CHART_TEXT   # 出生资料没变
    assert update(_profile(), _profile()) == CHART_TEXT


def test_user_context_ends_with_chart_status():
    from services.context_service import build_user_context

    def status(user):
        return build_user_context(user).splitlines()[-1]

    assert build_user_context(_user(chart=CHART_TEXT)).splitlines()[-3:] == ["本命星盘：", *CHART_TEXT.splitlines()]
    assert status(_user()) == "本命星盘：未保存（出生资料齐全，可以排盘）"
    assert status(_user(profile=_profile(birth_minute=None, birth_city=None))) \
        == "本命星盘：无法排盘（缺出生时间、出生地点）"
    assert build_user_context(_user(profile=UserProfile())).splitlines() == [
        "", "# <用户资料>", "尚未完善", "本命星盘：无法排盘（缺出生日期、出生时间、出生地点）"]
    assert build_user_context(User(user_id="u", user_type=UserType.GUEST)) == ""   # 没有资料对象：和以前一样不出这一块


def test_user_api_responses_do_not_carry_chart(tmp_path, monkeypatch):
    """登录、取用户、改资料返回的用户信息和以前一样，没有 natal_chart 这个键。"""
    from fastapi.testclient import TestClient
    import main
    from services import db as db_module

    monkeypatch.setattr(db_module, "DB_FILE", tmp_path / "app.db")
    monkeypatch.setattr(db_module, "_initialized", False)
    client = TestClient(main.app)
    auth = client.post("/api/users/register", json={"username": "chart_hidden", "password": "pw123456"}).json()
    headers = {"Authorization": f"Bearer {auth['access_token']}"}
    uid = auth["user"]["user_id"]
    stored = asyncio.run(StorageService.get_user(uid))
    stored.natal_chart = CHART_TEXT
    asyncio.run(StorageService.save_user(stored))

    login = client.post("/api/users/login", json={"username": "chart_hidden", "password": "pw123456"}).json()
    got = client.get(f"/api/users/{uid}", headers=headers).json()
    updated = client.put(f"/api/users/{uid}/profile", json={"nickname": "夏"}, headers=headers).json()
    for user in (auth["user"], login["user"], got, updated):
        assert "natal_chart" not in user
    assert asyncio.run(StorageService.get_user(uid)).natal_chart == CHART_TEXT   # 只是不返回，库里还在


def test_cleanup_script_picks_guest_notebooks_by_user_type(tmp_path):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    from cleanup_guest_notebooks import find_guest_notebooks

    db_file = tmp_path / "app.db"
    db = sqlite3.connect(db_file)
    db.execute("CREATE TABLE users (user_id TEXT PRIMARY KEY, username TEXT, data TEXT NOT NULL)")
    for user_id, user_type in [("guest_a", "guest"), ("guest_b", "registered"), ("user_c", "registered")]:
        db.execute("INSERT INTO users VALUES (?, NULL, ?)",
                   (user_id, f'{{"user_id": "{user_id}", "user_type": "{user_type}"}}'))
    db.commit()
    db.close()
    notebooks = tmp_path / "notebooks"
    notebooks.mkdir()
    for name in ["guest_a", "guest_b", "user_c", "gone"]:
        (notebooks / f"note_{name}.log").write_text("[]")
        (notebooks / f"portrait_{name}.json").write_text("{}")

    guests, orphans = find_guest_notebooks(db_file, notebooks)
    # 笔记和画像都要删干净；转正的 guest_b 不算游客
    assert [p.name for p in guests] == ["note_guest_a.log", "portrait_guest_a.json"]
    assert [p.name for p in orphans] == ["note_gone.log", "portrait_gone.json"]
    assert len(list(notebooks.iterdir())) == 8                   # 只查不删
