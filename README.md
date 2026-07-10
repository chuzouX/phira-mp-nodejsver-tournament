# Tournament Plugin

排行榜模式比赛插件，支持比赛创建、选手注册、实时计分和排行榜展示。

## 功能特性

- ✅ **比赛管理** - 创建、开始、结束、删除比赛
- ✅ **选手管理** - 注册、邀请、取消注册选手
- ✅ **两种计分模式** - 最佳成绩（Best）和累计成绩（Sum）
- ✅ **自动计分** - 游戏结束时自动记录选手成绩
- ✅ **排行榜** - 实时查看比赛排名
- ✅ **房间白名单** - 自动管理比赛房间的选手白名单
- ✅ **数据持久化** - 比赛数据自动保存到磁盘

## 配置方法

在 `config/tournament/config.yaml` 中配置：

```yaml
# 默认计分模式 (best / sum)
defaultScoreMode: best

# 排行榜最大条目数
maxLeaderboardEntries: 1000

# 是否播报比赛结果
announceResults: true

# 结果播报频道
resultAnnouncementChannel: all
```

## 控制台命令

### tournament list
列出所有比赛。

### tournament create \<id\> \<name\> \<roomId\>
创建新比赛。

### tournament info \<id\>
查看比赛详情。

### tournament start \<id\>
开始比赛。

### tournament end \<id\>
结束比赛。

### tournament delete \<id\>
删除比赛。

### tournament register \<id\> \<userId\>
注册选手。

### tournament invite \<id\> \<userId\>
邀请选手。

### tournament unregister \<id\> \<userId\>
取消注册选手。

### tournament leaderboard \<id\>
显示排行榜。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tournament/list` | 获取比赛列表 |
| POST | `/api/tournament` | 创建比赛 |
| GET | `/api/tournament/:id` | 获取比赛详情 |
| PUT | `/api/tournament/:id/start` | 开始比赛 |
| PUT | `/api/tournament/:id/end` | 结束比赛 |
| DELETE | `/api/tournament/:id` | 删除比赛 |
| POST | `/api/tournament/:id/register` | 注册选手 |
| POST | `/api/tournament/:id/invite` | 邀请选手 |
| DELETE | `/api/tournament/:id/register/:userId` | 取消注册 |
| GET | `/api/tournament/:id/leaderboard` | 获取排行榜 |

## 计分模式

### 最佳成绩（Best）
每位选手只保留最高分记录，按最高分排名。

### 累计成绩（Sum）
每位选手所有成绩相加，按总分排名，准确率为平均值。

## 工作原理

1. 管理员创建比赛并指定关联房间
2. 选手注册或受邀加入比赛
3. 比赛开始后，选手在关联房间进行游戏
4. 每局游戏结束时自动记录成绩
5. 可通过排行榜查看实时排名

## 开发者信息

- **插件 ID**: tournament
- **UUID**: e8a3d2b1-6c4f-4e9a-8b7d-2c5f9a4e6d3b
- **版本**: 1.1.0
- **依赖**: 无
