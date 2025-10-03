import random
from typing import List
from models import TarotCard, DrawCardsRequest
from config import TAROT_CARDS


class TarotService:
    """塔罗牌服务"""
    
    @staticmethod
    def draw_cards(draw_request: DrawCardsRequest) -> List[TarotCard]:
        """抽取塔罗牌"""
        # 生成一副完整的牌（78张）
        all_cards = list(range(len(TAROT_CARDS)))
        
        # 随机洗牌
        random.shuffle(all_cards)
        
        # 抽取指定数量的牌
        drawn_card_ids = all_cards[:draw_request.card_count]
        
        # 生成塔罗牌对象
        cards = []
        for card_id in drawn_card_ids:
            # 随机决定是否逆位（30%概率）
            reversed = random.random() < 0.3
            
            card = TarotCard(
                card_id=card_id,
                card_name=TAROT_CARDS[card_id],
                reversed=reversed
            )
            cards.append(card)
        
        return cards
    
    @staticmethod
    def get_all_cards() -> List[str]:
        """获取所有塔罗牌名称"""
        return TAROT_CARDS.copy()
    
    @staticmethod
    def get_card_name(card_id: int) -> str:
        """根据ID获取牌名"""
        if 0 <= card_id < len(TAROT_CARDS):
            return TAROT_CARDS[card_id]
        return "未知牌"



