graph TD
    %% 定义样式
    classDef agentFill fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;
    classDef envFill fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;
    classDef process fill:#fff,stroke:#333,stroke-width:1px;
    classDef dataStore fill:#fff9c4,stroke:#fbc02d,stroke-width:2px,stroke-dasharray: 5 5;

    subgraph ENVIRONMENT_SUB[ ]
        style ENVIRONMENT_SUB fill:none,stroke:none
        Env[环境 <br> Environment]:::envFill
    end

    subgraph AGENT_SUB[智能体 AGENT]
        style AGENT_SUB fill:#f4fcfd,stroke:#0288d1,stroke-width:2px,dashed

        %% 智能体内部组件
        Perception(感知与输入处理 <br> Perception):::process
        StateUpdate(状态更新与记忆检索 <br> State Update & Memory Recall):::process
        Reasoning(推理与规划 <br> Reasoning & Planning):::process
        Decision(决策与动作选择 <br> Decision Making):::process
        
        %% 数据存储（记忆与目标）
        Memory[(记忆模块 <br> Memory <br> 短期/长期)]:::dataStore
        Goals[目标与任务 <br> Goals & Tasks]:::dataStore
    end

    %% 主循环流程
    Env -- "1. 观察/状态 (Observations/State)" --> Perception
    Perception --> StateUpdate
    StateUpdate --> Reasoning
    Reasoning --> Decision
    Decision -- "2. 动作执行 (Actions)" --> Env

    %% 内部数据流交互
    StateUpdate <--> Memory
    Reasoning <--> Memory
    Reasoning <--> Goals

    %% 添加一个循环箭头指示整体流程
    Env -.- |"环境反馈 (Feedback/New State)"| Perception
    linkStyle 8 stroke:red,stroke-width:2px,fill:none,dashed;