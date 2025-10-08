import json
import requests
# url = 'http://www.xingpan.vip/astrology/chart/natal'
# header = {"Content-Type": "application/json;charset=UTF-8"}
# datas = {
# "access_token": "989f888c4283e2cc2d8a5aa4af60932c",
# "birthday": "1994-09-0115:30",
# "h_sys": "P",
# "latitude": "30.60",
# "longitude": "114.30",
# "planets":[0,1],
# # 'planet_xs': ['433'],
# # 'planet_xf': ['Regulus'],
# 'virtual': ['21'],
# # 'phase': {'0':0.5,'30':0.5},
# "tz": "8.00",
# }
# r = requests.post(url,headers=header,data=json.dumps(datas))
# # 打印virtual虚星数据
# print("\n[虚星数据]")
# data = r.json()
# if data.get("code") == 0:
#     print(data)
#     virtual_points = data.get("data", {}).get("virtual", [])
#     if virtual_points:
#         print(f"共 {len(virtual_points)} 个虚星:")
#         for virt in virtual_points:
#             virt_name = virt.get("planet_chinese", "未知")
#             sign_name = virt.get("sign", {}).get("sign_chinese", "未知")
#             house_id = virt.get("house_id", "未知")
#             code_name = virt.get("code_name", "未知")
#             print(f"- {virt_name} (code={code_name}): {sign_name}座，第{house_id}宫")
#     else:
#         print("未返回虚星数据")
# else:
#     print(f"API调用失败: {data.get('msg')}")

url = 'http://www.xingpan.vip/astrology/corpusconstellation/getlist'
header = {"Content-Type": "application/json;charset=UTF-8"}
datas = {
    "fallInto": json.dumps([{"type": 4, "planet_id": "0", "house_id": 1}, {"type": 4, "planet_id": "1", "house_id": 2},
{"type": 5, "planet_id": "0", "sign_id": 8}, {"type": 5, "planet_id": "1", "sign_id": 9},
{"type": 6, "planet_id1": "0", "planet_id2": "1", "degree": 30}]),
   "chartType": "natal",
   "access_token": "989f888c4283e2cc2d8a5aa4af60932c"}
r = requests.post(url,headers=header,data=json.dumps(datas))
print(datas)
print("+==========================================================+")
print(r.text)

