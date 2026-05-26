# Ledger — Deploy Checklist

Every code change must go through this process.

---

## 1. Bump the version

Edit `package.json` — follow semver:

| Change type | Bump |
|-------------|------|
| New command or feature | minor |
| Bug fix or output change | patch |

---

## 2. Commit and push to GitHub

```bash
cd /root/locol/projects/discord/bots/ledger
git add -p
git commit -m "feat/fix: ..."
git push origin main
```

---

## 3. Trigger Coolify deploy

```bash
curl -s -X POST "https://coolify.locolbeef.com/api/v1/deploy?uuid=t10qik1wcvbyps5b5x0wzsn2&force=false" \
  -H "Authorization: Bearer 3|623fW2W2iyoBjHKIvh8JNivwhYHZneJzbLCyUFSgcea48543"
```

---

## 4. Verify

```bash
curl https://ledger.locolbeef.com/health
# → {"status":"ok","service":"ledger","version":"X.Y.Z"}
```

---

## 5. Re-register Discord commands (only when command structure changes)

```bash
sshpass -p '1master1' ssh -o StrictHostKeyChecking=no nontapan-coolify@192.168.1.158 \
  "echo '1master1' | sudo -S docker exec \$(sudo docker ps --format '{{.Names}}' 2>/dev/null | grep t10qik1) bun src/deploy-commands.ts 2>/dev/null"
```

---

## Quick reference

| What | Where |
|------|-------|
| Health check | `https://ledger.locolbeef.com/health` |
| Coolify dashboard | `https://coolify.locolbeef.com` |
| GitHub repo | `https://github.com/locol-company/ledger` |
| Coolify app UUID | `t10qik1wcvbyps5b5x0wzsn2` |
| Discord app ID | `1508769223369953310` |
| Discord guild ID | `1508393525752893500` |
