#!/bin/bash
set -e

# OpenClaw Memory Bridge - One-Click Installer
# ===========================================

echo "🧠 OpenClaw Memory Bridge - 安装开始"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if OpenClaw is installed
if ! command -v openclaw &> /dev/null; then
    echo -e "${RED}❌ OpenClaw 未安装。请先安装 OpenClaw。${NC}"
    echo "   官网: https://docs.openclaw.ai"
    exit 1
fi

echo -e "${GREEN}✅ OpenClaw 已安装${NC}"

# Get OpenClaw directory
OPENCLAW_DIR=$(openclaw config --get-dir 2>/dev/null || echo "$HOME/.openclaw")
EXTENSIONS_DIR="$OPENCLAW_DIR/extensions"
PLUGIN_DIR="$EXTENSIONS_DIR/evermem-bridge"

echo -e "${BLUE}📁 安装目录: $PLUGIN_DIR${NC}"

# Create extensions directory if it doesn't exist
mkdir -p "$EXTENSIONS_DIR"

# Check if plugin already exists
if [ -d "$PLUGIN_DIR" ]; then
    echo -e "${YELLOW}⚠️ 插件已存在，正在更新...${NC}"
    rm -rf "$PLUGIN_DIR"
fi

# Create plugin directory
mkdir -p "$PLUGIN_DIR"

# Copy plugin files
if [ -f "plugins/evermem-bridge/index.ts" ]; then
    # If running from repo
    cp -r plugins/evermem-bridge/* "$PLUGIN_DIR/"
    echo -e "${GREEN}✅ 插件文件已复制${NC}"
else
    # If running from curl | bash
    echo -e "${BLUE}📥 从 GitHub 下载插件文件...${NC}"
    
    # Download plugin files
    curl -sSL "https://raw.githubusercontent.com/TheSoulGiver/openclaw-memory-bridge/main/plugins/evermem-bridge/index.ts" -o "$PLUGIN_DIR/index.ts"
    curl -sSL "https://raw.githubusercontent.com/TheSoulGiver/openclaw-memory-bridge/main/plugins/evermem-bridge/package.json" -o "$PLUGIN_DIR/package.json"
    curl -sSL "https://raw.githubusercontent.com/TheSoulGiver/openclaw-memory-bridge/main/plugins/evermem-bridge/openclaw.plugin.json" -o "$PLUGIN_DIR/openclaw.plugin.json"
    
    echo -e "${GREEN}✅ 插件文件下载完成${NC}"
fi

# Check EverMemOS dependency
echo -e "${BLUE}🔍 检查 EverMemOS...${NC}"

# Check if EverMemOS is running
if curl -s --connect-timeout 3 http://localhost:8001/health &> /dev/null; then
    echo -e "${GREEN}✅ EverMemOS 正在运行${NC}"
else
    echo -e "${YELLOW}⚠️ EverMemOS 未运行${NC}"
    echo -e "${BLUE}💡 EverMemOS 是可选的。如需完整记忆功能，请安装 EverMemOS:${NC}"
    echo "   git clone https://github.com/EverMemOS/EverMemOS.git"
    echo "   cd EverMemOS && ./scripts/install.sh"
    echo ""
    echo -e "${GREEN}继续安装 Memory Bridge 插件...${NC}"
fi

# Check Ollama for embedding (optional)
echo -e "${BLUE}🔍 检查 Ollama (用于本地 embedding)...${NC}"
if command -v ollama &> /dev/null; then
    echo -e "${GREEN}✅ Ollama 已安装${NC}"
    
    # Check if qwen3-embedding model is available
    if ollama list | grep -q "qwen3-embedding"; then
        echo -e "${GREEN}✅ qwen3-embedding 模型已安装${NC}"
    else
        echo -e "${YELLOW}⚠️ 推荐安装 qwen3-embedding 模型:${NC}"
        echo "   ollama pull qwen3-embedding"
    fi
else
    echo -e "${YELLOW}⚠️ Ollama 未安装 (可选)${NC}"
    echo -e "${BLUE}💡 安装 Ollama 可启用本地 embedding:${NC}"
    echo "   https://ollama.ai/"
fi

# Create default config if it doesn't exist
CONFIG_FILE="$PLUGIN_DIR/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${BLUE}📝 创建默认配置...${NC}"
    cat > "$CONFIG_FILE" << 'EOF'
{
  "evermem_api_base": "http://localhost:8001/api/v1",
  "embedding": {
    "provider": "ollama",
    "model": "qwen3-embedding",
    "api_base": "http://localhost:11434/v1",
    "dimensions": 1024
  },
  "memory": {
    "auto_recall": true,
    "max_recall_items": 10,
    "similarity_threshold": 0.7
  },
  "logging": {
    "level": "info",
    "file": "memory-bridge.log"
  }
}
EOF
    echo -e "${GREEN}✅ 默认配置已创建${NC}"
fi

# Restart OpenClaw Gateway if running
echo -e "${BLUE}🔄 重启 OpenClaw Gateway...${NC}"
if openclaw gateway status &> /dev/null; then
    openclaw gateway restart
    echo -e "${GREEN}✅ OpenClaw Gateway 已重启${NC}"
else
    echo -e "${YELLOW}⚠️ OpenClaw Gateway 未运行，请手动启动${NC}"
    echo "   openclaw gateway start"
fi

# Final verification
echo ""
echo -e "${GREEN}🎉 安装完成！${NC}"
echo "====================================="
echo -e "${BLUE}📋 验证安装:${NC}"
echo "   openclaw extensions list"
echo "   openclaw emem health"
echo ""
echo -e "${BLUE}📚 使用方法:${NC}"
echo "   memory_search(query='关键词')  # 搜索记忆"
echo "   memory_store(content='内容')   # 存储记忆"
echo "   memory_get(memory_type='profile')  # 获取用户画像"
echo ""
echo -e "${BLUE}📖 文档:${NC}"
echo "   https://github.com/TheSoulGiver/openclaw-memory-bridge"
echo ""
echo -e "${GREEN}享受持久化记忆的 AI 体验！ 🧠✨${NC}"