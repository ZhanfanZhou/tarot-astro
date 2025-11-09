from fastapi import APIRouter, HTTPException
from typing import List
from models import (
    Conversation, CreateConversationRequest, 
    UpdateConversationTitleRequest
)
from services.conversation_service import ConversationService
from services.notebook_service import notebook_service
from services.storage_service import StorageService

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post("", response_model=Conversation)
async def create_conversation(request: CreateConversationRequest, user_id: str):
    """创建新对话"""
    try:
        conversation = await ConversationService.create_conversation(
            user_id=user_id,
            session_type=request.session_type
        )
        return conversation
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """获取对话详情"""
    conversation = await ConversationService.get_conversation(conversation_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="对话不存在")
    return conversation


@router.get("/user/{user_id}", response_model=List[Conversation])
async def get_user_conversations(user_id: str):
    """获取用户的所有对话"""
    try:
        conversations = await ConversationService.get_user_conversations(user_id)
        return conversations
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/title", response_model=Conversation)
async def update_title(request: UpdateConversationTitleRequest):
    """更新对话标题"""
    try:
        conversation = await ConversationService.update_conversation_title(
            request.conversation_id,
            request.title
        )
        return conversation
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """删除对话"""
    try:
        await ConversationService.delete_conversation(conversation_id)
        return {"message": "对话已删除"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{conversation_id}/exit")
async def exit_conversation(conversation_id: str):
    """
    对话退出时的处理
    检查是否需要生成占卜笔记
    
    触发条件：
    1. 对话内容有新增（消息数 > 1）
    2. 对话中抽过塔罗牌
    3. 对话内容有变化（end_time != updated_at）
    4. 距离对话结束超过12小时
    """
    try:
        from datetime import datetime, timedelta
        
        # 获取对话
        conversation = await ConversationService.get_conversation(conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="对话不存在")
        
        # 检查是否满足生成笔记的基本条件
        # 条件1: 消息数 > 1（至少有用户消息和助手回复）
        has_content = len(conversation.messages) > 1
        
        # 条件2: 抽过塔罗牌
        has_drawn_cards = conversation.has_drawn_cards or any(
            msg.tarot_cards for msg in conversation.messages
        )
        
        print(f"\n{'='*60}")
        print(f"[ConversationExit] 对话 {conversation_id} 退出检查")
        print(f"{'='*60}")
        print(f"基本条件检查:")
        print(f"  - 有内容: {has_content} (消息数: {len(conversation.messages)})")
        print(f"  - 抽过牌: {has_drawn_cards}")
        print(f"  - 对话结束时间 (updated_at): {conversation.updated_at}")
        
        if has_content and has_drawn_cards:
            # 获取用户信息
            user = await StorageService.get_user(conversation.user_id)
            
            # 调用笔记更新服务，返回详细检查结果
            result = await notebook_service.update_entry(
                user_id=conversation.user_id,
                conversation=conversation,
                user=user
            )
            
            # 打印详细的生成条件检查
            print(f"\n笔记生成条件检查:")
            print(f"  - 对话是否有变化: {result['conversation_changed']}")
            if result['existing_entry']:
                # 尝试获取旧的 end_time 显示
                notebook_entries = notebook_service._load_notebook(conversation.user_id)
                for entry in notebook_entries:
                    if entry.conversation_id == conversation_id:
                        print(f"    * 上次记录的 end_time: {entry.end_time}")
                        print(f"    * 当前对话 updated_at: {conversation.updated_at}")
                        break
            else:
                print(f"    * 首次生成笔记")
            
            print(f"  - 时间是否超过12小时: {result['time_elapsed']}")
            try:
                conversation_end_time = datetime.fromisoformat(conversation.updated_at)
                current_time = datetime.utcnow()
                time_diff = current_time - conversation_end_time
                print(f"    * 对话结束于: {conversation_end_time}")
                print(f"    * 当前时间: {current_time}")
                print(f"    * 时间差: {time_diff} ({time_diff.total_seconds() / 3600:.2f} 小时)")
            except:
                pass
            
            print(f"  - 是否应该生成笔记: {result['should_generate']}")
            print(f"  - 笔记是否已更新: {result.get('notebook_updated', False)}")
            print(f"{'='*60}\n")
            
            if result.get('notebook_updated', False):
                return {"message": "笔记已保存", "notebook_updated": True, "details": result}
            else:
                return {
                    "message": "不满足笔记生成条件", 
                    "notebook_updated": False, 
                    "details": result
                }
        else:
            print(f"不满足基本条件，跳过笔记生成")
            print(f"{'='*60}\n")
            return {"message": "不需要生成笔记", "notebook_updated": False}
    
    except Exception as e:
        print(f"[ConversationExit] 处理对话退出失败: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



