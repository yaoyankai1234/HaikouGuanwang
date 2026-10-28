# 部署说明

本项目当前有三个线上入口，代码同源（均来自仓库 `main` 分支）：

| 入口 | 地址 | 说明 |
|---|---|---|
| 正式域名 | https://hngw.toryan.cn | 阿里云 ECS + Nginx 反代（推荐对外） |
| 直连端口 | http://8.134.188.190:8088 | 阿里云 node 服务直连（调试用） |
| WorkBuddy | https://water-supply-pms.app.workbuddy.host | WorkBuddy 托管沙盒 |

---

## 1. 构建

```bash
npm ci
npm run build      # tsc --noEmit && vite build → 产物输出到 webui/
```

`webui/` 是后端直接托管的前端产物目录（`server/index.mjs` 中 `join(__dirname, '..', 'webui')`），
**部署时必须一起上传**，否则前端还是旧版本。

## 2. 阿里云（8.134.188.190）

```bash
# 备份业务数据（server/data 不在版本控制内）
ssh root@8.134.188.190 'tar -czf /opt/pms_backup_$(date +%Y%m%d_%H%M%S).tar.gz -C /opt/pms server/data'

# 同步代码（含 webui/，排除 server/data 与 node_modules）
rsync -avz --delete \
  --exclude='node_modules' --exclude='server/data' --exclude='.git' \
  --exclude='.workbuddy' --exclude='.wbapp_*.genie' \
  --exclude='vite.config.ts.timestamp-*.mjs' --exclude='.DS_Store' \
  -e "ssh -o StrictHostKeyChecking=no" \
  ./ root@8.134.188.190:/opt/pms/

ssh root@8.134.188.190 'cd /opt/pms && npm install --omit=dev && pm2 restart pms'
curl -s http://127.0.0.1:8088/api/health
```

> ⚠️ `--delete` + `--exclude` 组合下，被排除的 `server/data` **不会**被删除，但本地多余的 `webui/assets/*`
> 旧 hash 文件会被清理——这是期望行为。

## 3. Nginx 域名映射

配置文件见 `deploy/nginx/hngw.toryan.cn.conf`。

```bash
cp deploy/nginx/hngw.toryan.cn.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/hngw.toryan.cn.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 证书

- 域名 `toryan.cn` 由 **acme.sh + 阿里云 DNS-01** 签发通配符证书 `*.toryan.cn`
- 证书路径：`/etc/nginx/ssl/toryan.cn/{fullchain.pem,key.pem}`
- **任意 `*.toryan.cn` 子域可直接复用该证书**，新增子域无需重新签发
- 自动续期：crontab 每日 `03:17` 执行 `acme.sh --cron`，续期后由 `Le_ReloadCmd` 自动 `systemctl reload nginx`
- 当前有效期至 2027-01-26，下次续期 2026-12-26

### DNS

```
hngw.toryan.cn  A  8.134.188.190
```

## 4. WorkBuddy 托管

通过 WorkBuddy 的站点发布能力部署，入口 https://water-supply-pms.app.workbuddy.host 。

> ⚠️ 沙盒每次重新部署后，`ensureAdmin` 会用默认凭据重建管理员账号
> （`13800000000 / admin123`），需立即用管理接口改回正式账号：
> `18202810551 / yaoyankai421992`。
> 注意 WorkBuddy 网关会注入自己的 `Authorization` 头覆盖客户端 token，
> 调用管理接口必须使用 **`X-PMS-Token`** 自定义头。

---

## 管理员账号

三端统一：`18202810551 / yaoyankai421992`（角色 admin）
