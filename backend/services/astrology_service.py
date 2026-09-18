import httpx
import json
from typing import Any, Dict, List, Optional
from datetime import datetime
from config import ASTROLOGY_API_URL, ASTROLOGY_ACCESS_TOKEN


class AstrologyService:
    """星盘服务"""
    
    # 主要城市的经纬度数据（简化版，实际应用应该使用完整的地理编码服务）
    CITY_COORDINATES = {
        "北京": {"latitude": "39.9042", "longitude": "116.4074", "tz": "+8"},
        "上海": {"latitude": "31.2304", "longitude": "121.4737", "tz": "+8"},
        "广州": {"latitude": "23.1291", "longitude": "113.2644", "tz": "+8"},
        "深圳": {"latitude": "22.5431", "longitude": "114.0579", "tz": "+8"},
        "成都": {"latitude": "30.5728", "longitude": "104.0668", "tz": "+8"},
        "杭州": {"latitude": "30.2741", "longitude": "120.1551", "tz": "+8"},
        "重庆": {"latitude": "29.4316", "longitude": "106.9123", "tz": "+8"},
        "西安": {"latitude": "34.3416", "longitude": "108.9398", "tz": "+8"},
        "武汉": {"latitude": "30.5928", "longitude": "114.3055", "tz": "+8"},
        "南京": {"latitude": "32.0603", "longitude": "118.7969", "tz": "+8"},
        "天津": {"latitude": "39.3434", "longitude": "117.3616", "tz": "+8"},
        "苏州": {"latitude": "31.2989", "longitude": "120.5853", "tz": "+8"},
        "郑州": {"latitude": "34.7466", "longitude": "113.6253", "tz": "+8"},
        "长沙": {"latitude": "28.2282", "longitude": "112.9388", "tz": "+8"},
        "沈阳": {"latitude": "41.8057", "longitude": "123.4328", "tz": "+8"},
        "青岛": {"latitude": "36.0671", "longitude": "120.3826", "tz": "+8"},
        "香港": {"latitude": "22.3193", "longitude": "114.1694", "tz": "+8"},
        "台北": {"latitude": "25.0330", "longitude": "121.5654", "tz": "+8"},
    }
    
    # 标准星体ID列表（根据星盘API文档）
    # 包含10大行星 + 婚神星(H) + 北交点(m)
    STANDARD_PLANETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "H", "m"]
    
    # 虚星ID列表（南交点等）
    # 注意：根据测试，南交点(21)应该放在virtual参数中，不是planets参数
    VIRTUAL_POINTS = ["10", "21"]  # 10: 上升, 21: 南交点 (Mean South Node)
    
    # 小行星ID列表（暂时不使用，API的小行星格式比较特殊）
    ASTEROIDS = []
    
    BIRTH_FIELD_LABELS = {"birth_date": "出生日期", "birth_time": "出生时间", "birth_city": "出生地点"}

    @staticmethod
    def missing_birth_fields(profile) -> List[str]:
        """排盘还缺哪几项（birth_date / birth_time / birth_city）。profile 可为 None。"""
        missing = []
        if not (profile and profile.birth_year and profile.birth_month and profile.birth_day):
            missing.append("birth_date")
        if not profile or profile.birth_hour is None or profile.birth_minute is None:
            missing.append("birth_time")
        if not (profile and profile.birth_city):
            missing.append("birth_city")
        return missing

    @staticmethod
    def get_city_coordinates(city: str) -> Optional[Dict[str, str]]:
        """获取城市经纬度"""
        return AstrologyService.CITY_COORDINATES.get(city)
    
    @staticmethod
    async def fetch_natal_chart(
        birth_year: int,
        birth_month: int,
        birth_day: int,
        birth_hour: int,
        birth_minute: int,
        city: str
    ) -> Optional[Dict[str, Any]]:
        """
        获取本命盘数据
        
        Args:
            birth_year: 出生年份
            birth_month: 出生月份
            birth_day: 出生日期
            birth_hour: 出生小时
            birth_minute: 出生分钟
            city: 出生城市
            
        Returns:
            星盘数据字典，如果失败返回 None
        """
        # 获取城市经纬度
        coordinates = AstrologyService.get_city_coordinates(city)
        if not coordinates:
            # 如果城市不在列表中，使用北京作为默认值
            coordinates = AstrologyService.CITY_COORDINATES["北京"]
        
        # 构造生日字符串
        birthday = f"{birth_year}-{birth_month:02d}-{birth_day:02d} {birth_hour:02d}:{birth_minute:02d}:00"
        
        # 构造请求参数
        params = {
            "access_token": ASTROLOGY_ACCESS_TOKEN,
            "planets": AstrologyService.STANDARD_PLANETS,
            "planet_xs": AstrologyService.ASTEROIDS,  # 小行星
            "virtual": AstrologyService.VIRTUAL_POINTS,  # 虚星（南交点等）
            "h_sys": "B",  # 阿卡比特宫位制
            "longitude": coordinates["longitude"],
            "latitude": coordinates["latitude"],
            "tz": coordinates["tz"],
            "birthday": birthday,
            # "svg_type": "0",  # 不返回SVG图片
            # "is_corpus": "1",  # 返回语料
        }
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                # 打印请求信息
                print(f"\n[星盘API] 正在调用星盘API...")
                print(f"[星盘API] 出生信息: {birthday} @ {city}")
                
                # 🆕 打印请求的JSON数据
                print(f"\n[星盘API] 📤 请求JSON数据：")
                print("-" * 60)
                print(json.dumps(params, indent=2, ensure_ascii=False))
                print("-" * 60)
                
                response = await client.post(ASTROLOGY_API_URL, json=params)
                response.raise_for_status()
                
                data = response.json()
                if data.get("code") == 0:
                    print(f"\n[星盘API] ✅ API调用成功")
                    chart_data = data.get("data")
                    
                    # 打印关键数据摘要
                    planets = chart_data.get("planet", [])
                    houses = chart_data.get("house", [])
                    planet_xs = chart_data.get("planet_xs", [])
                    virtual = chart_data.get("virtual", [])
                    
                    print(f"[星盘API] 📊 数据摘要：")
                    print(f"  - 主要行星: {len(planets)} 个")
                    print(f"  - 小行星: {len(planet_xs)} 个")
                    print(f"  - 虚星: {len(virtual)} 个")
                    print(f"  - 宫位: {len(houses)} 个")
                    
                    # 打印行星数据
                    if planets:
                        print(f"\n[星盘API] 行星数据：")
                        for planet in planets:
                            planet_name = planet.get("planet_chinese", "未知")
                            sign_name = planet.get("sign", {}).get("sign_chinese", "未知")
                            house_id = planet.get("house_id", "未知")
                            print(f"  - {planet_name}: {sign_name}座，第{house_id}宫")
                    
                    # 打印小行星数据
                    if planet_xs:
                        print(f"\n[星盘API] 小行星数据：")
                        for asteroid in planet_xs:
                            asteroid_name = asteroid.get("planet_chinese", "未知")
                            sign_name = asteroid.get("sign", {}).get("sign_chinese", "未知")
                            house_id = asteroid.get("house_id", "未知")
                            code_name = asteroid.get("code_name", "未知")
                            print(f"  - {asteroid_name} (ID:{code_name}): {sign_name}座，第{house_id}宫")
                    
                    # 打印虚星数据
                    print(f"\n[星盘API] 🔍 调试虚星数据：")
                    print(f"  - 虚星数组长度: {len(virtual)}")
                    print(f"  - 请求参数 virtual={params.get('virtual')}")
                    
                    if virtual:
                        print(f"\n[星盘API] 🌟 虚星数据（共{len(virtual)}个）：")
                        for idx, virt in enumerate(virtual):
                            virt_name = virt.get("planet_chinese", "未知")
                            sign_name = virt.get("sign", {}).get("sign_chinese", "未知")
                            house_id = virt.get("house_id", "未知")
                            code_name = virt.get("code_name", "未知")
                            print(f"  [{idx}] {virt_name} (code={code_name}, 类型={type(code_name).__name__}): {sign_name}座，第{house_id}宫")
                    else:
                        print(f"\n[星盘API] ⚠️ 虚星数据为空")
                        print(f"[星盘API] 说明：API没有返回virtual字段或返回空数组")
                    
                    return chart_data
                else:
                    print(f"\n[星盘API] ❌ API返回错误: {data.get('msg')}")
                    return None
        except Exception as e:
            print(f"\n[星盘API] ❌ 调用失败: {str(e)}")
            return None
    
    @staticmethod
    def format_chart_data_to_text(chart_data: Dict[str, Any], user_info: Dict[str, Any]) -> str:
        """
        将星盘数据格式化为文字描述
        
        Args:
            chart_data: 星盘API返回的数据
            user_info: 用户信息（出生日期、城市等）
            
        Returns:
            文字描述的星盘信息
        """
        text_parts = []
        
        # 基本信息
        text_parts.append("【星盘基本信息】")
        text_parts.append(f"出生日期：{user_info['birth_year']}年{user_info['birth_month']}月{user_info['birth_day']}日")
        text_parts.append(f"出生时间：{user_info['birth_hour']:02d}:{user_info['birth_minute']:02d}")
        text_parts.append(f"出生地点：{user_info['city']}")
        text_parts.append("")
        
        # 行星位置
        text_parts.append("【行星落座】")
        planets = chart_data.get("planet", [])
        planet_names = {
            "0": "太阳", "1": "月亮", "2": "水星", "3": "金星", "4": "火星",
            "5": "木星", "6": "土星", "7": "天王星", "8": "海王星", "9": "冥王星",
            "H": "婚神星",  # 婚神星（Juno）
            "m": "北交点",  # 北交点（Mean Node）
            "21": "南交点",  # 南交点（Mean South Node）- API返回时在planet数组中
            "10": "上升点",  # 上升点（Ascendant）- API返回时在planet数组中
        }
        
        # 虚星名称映射（实际上API可能将某些虚星放在planet数组中返回）
        virtual_names = {}
        
        # 处理所有行星（API会将所有请求的星体都放在planet数组中返回）
        # 包括：10大行星、婚神星、北交点、南交点、上升点等
        for planet in planets:
            code = str(planet.get("code_name"))  # 转换为字符串，因为可能是数字或字母
            if code in planet_names:
                planet_name = planet_names[code]
                sign_info = planet.get("sign", {})
                sign_name = sign_info.get("sign_chinese", "未知")
                degree = sign_info.get("deg", 0)
                minute = sign_info.get("min", 0)
                house_id = planet.get("house_id", "未知")
                
                text_parts.append(
                    f"{planet_name}：落在{sign_name}座 {degree}°{minute}' (第{house_id}宫)"
                )
        
        # 注意：星盘API实际上会将大部分星体（包括虚星）都放在planet数组中返回
        # 所以上面的循环已经处理了所有需要的星体数据
        
        text_parts.append("")
        
        # 宫位信息（简化版，只显示前4个主要宫位）
        text_parts.append("【四轴点】")
        houses = chart_data.get("house", [])
        important_houses = {1: "上升点 (ASC)", 4: "天底 (IC)", 7: "下降点 (DSC)", 10: "天顶 (MC)"}
        
        for house in houses:
            house_id = house.get("house_id")
            if house_id in important_houses:
                sign_info = house.get("sign", {})
                sign_name = sign_info.get("sign_chinese", "未知")
                degree = sign_info.get("deg", 0)
                minute = sign_info.get("min", 0)
                
                text_parts.append(
                    f"{important_houses[house_id]}：{sign_name}座 {degree}°{minute}'"
                )
        
        return "\n".join(text_parts)

    # 星盘文字的第一行：说明这种写法。宫的星座和宫里星体自己的星座常常不同，不写明会被读成同一个。
    HOUSES_LEGEND = "第几宫：这一宫落在的星座｜落在这一宫里的星体（括号里是星体自己所在的星座，可能和这一宫的星座不同）"

    @staticmethod
    def format_chart_houses(chart_data: Dict[str, Any]) -> str:
        """本命盘整理成 1 到 12 宫各一行：这一宫落在的星座，和落在这一宫里的星体（带它自己的星座）。

        这是基本星盘：存在 User.natal_chart，放进 <用户资料>。不写度数、不写出生信息。
        详细星盘仍由 get_astrology_chart 调接口取（format_chart_data_to_text），两者互不替代。
        """
        lines = [AstrologyService.HOUSES_LEGEND]
        for house in sorted(chart_data["house"], key=lambda h: h["house_id"]):
            line = f"第{house['house_id']}宫：{house['sign']['sign_chinese']}座"
            bodies = [f"{p['planet_chinese']}（{p['sign']['sign_chinese']}座）"
                      for p in chart_data["planet"] if p["house_id"] == house["house_id"]]
            if bodies:
                line += "｜" + "、".join(bodies)
            lines.append(line)
        return "\n".join(lines)
    
    @staticmethod
    def get_current_zodiac_sign() -> str:
        """获取当前时间对应的星座"""
        now = datetime.now()
        month = now.month
        day = now.day
        
        # 星座日期范围
        zodiac_dates = [
            (3, 21, 4, 19, "白羊座"),
            (4, 20, 5, 20, "金牛座"),
            (5, 21, 6, 21, "双子座"),
            (6, 22, 7, 22, "巨蟹座"),
            (7, 23, 8, 22, "狮子座"),
            (8, 23, 9, 22, "处女座"),
            (9, 23, 10, 23, "天秤座"),
            (10, 24, 11, 22, "天蝎座"),
            (11, 23, 12, 21, "射手座"),
            (12, 22, 1, 19, "摩羯座"),
            (1, 20, 2, 18, "水瓶座"),
            (2, 19, 3, 20, "双鱼座"),
        ]
        
        for start_month, start_day, end_month, end_day, zodiac in zodiac_dates:
            if (month == start_month and day >= start_day) or (month == end_month and day <= end_day):
                return zodiac
        
        return "白羊座"  # 默认值
