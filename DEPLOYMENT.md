# Deployment Guide

This guide covers deploying your NFT BuyBot to production environments.

## 🚀 Quick Deployment Options

### Option 1: Railway (Recommended for beginners)
Railway provides easy deployment with automatic HTTPS and environment management.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Set environment variables
railway variables set TELEGRAM_BOT_TOKEN=your_token_here
railway variables set ALCHEMY_API_KEY=your_alchemy_key
railway variables set ALCHEMY_AUTH_TOKEN=your_auth_token
railway variables set WEBHOOK_URL=https://your-app.railway.app

# Deploy
railway up
```

After deployment:
1. Get your Railway URL (e.g., `https://candy-rush-production.railway.app`)
2. Update `WEBHOOK_URL` in Railway dashboard
3. Redeploy if needed

### Option 2: Heroku
```bash
# Create Heroku app
heroku create your-nft-bot-name

# Configure environment variables
heroku config:set TELEGRAM_BOT_TOKEN=your_token
heroku config:set ALCHEMY_API_KEY=your_key
heroku config:set ALCHEMY_AUTH_TOKEN=your_auth_token
heroku config:set WEBHOOK_URL=https://your-nft-bot-name.herokuapp.com

# Deploy
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

### Option 3: DigitalOcean App Platform
```bash
# Create app.yaml
cat > app.yaml << EOF
name: nft-buybot
services:
- name: api
  source_dir: /
  github:
    repo: your-username/your-repo
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
  envs:
  - key: TELEGRAM_BOT_TOKEN
    value: your_token_here
  - key: ALCHEMY_API_KEY
    value: your_alchemy_key
  http_port: 3000
EOF

# Deploy using doctl CLI
doctl apps create app.yaml
```

## 🏗 Self-Hosted Deployment

### VPS/Server Deployment

#### 1. Server Setup (Ubuntu 20.04+)
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 for process management
sudo npm install -g pm2

# Install Nginx for reverse proxy
sudo apt install nginx

# Install Certbot for SSL
sudo apt install snapd
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

#### 2. Deploy Application
```bash
# Clone your repository
git clone https://github.com/your-username/nft-buybot.git
cd nft-buybot

# Install dependencies
npm ci --only=production

# Create production environment file
cp .env.example .env
nano .env  # Edit with your production values

# Start with PM2
pm2 start index.js --name "nft-buybot"
pm2 startup  # Follow the instructions
pm2 save
```

#### 3. Configure Nginx
```bash
# Create Nginx configuration
sudo nano /etc/nginx/sites-available/nft-buybot

# Add this configuration:
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# Enable the site
sudo ln -s /etc/nginx/sites-available/nft-buybot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 4. Setup SSL with Let's Encrypt
```bash
sudo certbot --nginx -d your-domain.com
```

## 🐳 Docker Deployment

### 1. Create Dockerfile
```dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodeuser -u 1001
USER nodeuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# Start application
CMD ["npm", "start"]
```

### 2. Create docker-compose.yml
```yaml
version: '3.8'

services:
  nft-buybot:
    build: .
    container_name: nft-buybot
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./database:/app/database
      - ./logs:/app/logs
    networks:
      - nft-bot-network

  nginx:
    image: nginx:alpine
    container_name: nft-bot-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - nft-buybot
    networks:
      - nft-bot-network

networks:
  nft-bot-network:
    driver: bridge
```

### 3. Deploy with Docker
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f nft-buybot

# Scale if needed
docker-compose up -d --scale nft-buybot=2
```

## ☁️ Cloud Deployment

### AWS ECS Deployment

#### 1. Create task definition (task-definition.json)
```json
{
  "family": "nft-buybot",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "nft-buybot",
      "image": "your-account.dkr.ecr.region.amazonaws.com/nft-buybot:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "TELEGRAM_BOT_TOKEN",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:telegram-bot-token"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/nft-buybot",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

#### 2. Deploy to ECS
```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-account.dkr.ecr.us-east-1.amazonaws.com

docker build -t nft-buybot .
docker tag nft-buybot:latest your-account.dkr.ecr.us-east-1.amazonaws.com/nft-buybot:latest
docker push your-account.dkr.ecr.us-east-1.amazonaws.com/nft-buybot:latest

# Create ECS service
aws ecs register-task-definition --cli-input-json file://task-definition.json
aws ecs create-service --cluster your-cluster --service-name nft-buybot --task-definition nft-buybot --desired-count 1 --launch-type FARGATE
```

### Google Cloud Run
```bash
# Build and deploy
gcloud builds submit --tag gcr.io/your-project/nft-buybot

gcloud run deploy nft-buybot \
  --image gcr.io/your-project/nft-buybot \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-secrets TELEGRAM_BOT_TOKEN=telegram-token:latest
```

## 📊 Monitoring & Logging

### Production Monitoring Setup

#### 1. PM2 Monitoring
```bash
# Install PM2 monitoring
pm2 install pm2-server-monit

# Setup monitoring dashboard
pm2 plus  # Follow registration process
```

#### 2. Log Aggregation with Winston
The bot already includes Winston logging. For production, consider:

```javascript
// Add to logger configuration
const logger = winston.createLogger({
  transports: [
    // Existing transports...
    
    // Add Splunk transport
    new winston.transports.Splunk({
      splunk: {
        token: process.env.SPLUNK_TOKEN,
        url: process.env.SPLUNK_URL
      }
    }),
    
    // Add DataDog transport
    new winston.transports.Http({
      host: 'http-intake.logs.datadoghq.com',
      path: `/v1/input/${process.env.DD_API_KEY}`,
      ssl: true
    })
  ]
});
```

#### 3. Application Performance Monitoring
```bash
# Install APM agent
npm install dd-trace  # DataDog
# or
npm install newrelic  # New Relic

# Add to top of index.js
require('dd-trace').init();
```

### Health Checks
The bot includes built-in health checks at `/health`. For Kubernetes:

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: nft-buybot
    image: your-image:latest
    livenessProbe:
      httpGet:
        path: /health
        port: 3000
      initialDelaySeconds: 30
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /health
        port: 3000
      initialDelaySeconds: 5
      periodSeconds: 5
```

## 🔧 Environment-Specific Configuration

### Production Environment Variables
```env
# Production settings
NODE_ENV=production
LOG_LEVEL=info

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Database
DATABASE_PATH=/app/data/database.sqlite

# Security
ALLOWED_ORIGINS=https://your-domain.com
HELMET_ENABLED=true

# Performance
MAX_WEBHOOK_PAYLOAD_SIZE=10mb
WEBHOOK_TIMEOUT=30000
```

### Staging Environment
```env
NODE_ENV=staging
LOG_LEVEL=debug
TELEGRAM_BOT_TOKEN=your_staging_bot_token
WEBHOOK_URL=https://staging-your-app.railway.app
```

## 🔒 Security Checklist

### Pre-Deployment Security
- [ ] All secrets in environment variables
- [ ] No hardcoded API keys in code
- [ ] HTTPS enabled for webhooks
- [ ] Rate limiting configured
- [ ] Input validation implemented
- [ ] SQL injection protection
- [ ] XSS protection headers
- [ ] Webhook signature verification

### Production Security
- [ ] Firewall configured (only ports 80, 443, 22)
- [ ] SSH key-only authentication
- [ ] Regular security updates
- [ ] Log monitoring for suspicious activity
- [ ] Backup strategy implemented
- [ ] SSL certificate auto-renewal

## 🔄 Backup & Recovery

### Database Backup
```bash
# Create backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
cp /app/database.sqlite /app/backups/database_$DATE.sqlite

# Keep only last 7 days
find /app/backups -name "database_*.sqlite" -mtime +7 -delete
```

### Automated Backups
```bash
# Add to crontab
crontab -e

# Backup every 6 hours
0 */6 * * * /app/scripts/backup.sh

# Upload to S3 daily
0 2 * * * aws s3 sync /app/backups s3://your-backup-bucket/database/
```

## 📈 Scaling Considerations

### Horizontal Scaling
For high traffic, consider:

1. **Load Balancing**: Use Nginx or cloud load balancer
2. **Multiple Instances**: Run multiple bot instances
3. **Database Scaling**: Move to PostgreSQL or MySQL
4. **Queue System**: Add Redis for webhook processing

### Performance Optimization
```javascript
// Add database connection pooling
const pool = require('generic-pool');

// Add caching layer
const redis = require('redis');
const client = redis.createClient();

// Rate limiting per user
const rateLimit = require('express-rate-limit');
```

## 🚨 Troubleshooting Deployment Issues

### Common Problems

**Bot not starting:**
```bash
# Check logs
pm2 logs nft-buybot
# or
docker-compose logs nft-buybot
```

**Database permissions:**
```bash
# Fix SQLite permissions
chown -R nodeuser:nodeuser /app/database
chmod 644 /app/database.sqlite
```

**Webhook not receiving:**
```bash
# Test webhook endpoint
curl -X POST https://your-domain.com/webhook/alchemy \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
```

**SSL/HTTPS issues:**
```bash
# Check certificate
openssl x509 -in /etc/letsencrypt/live/your-domain.com/cert.pem -text -noout
```

### Debug Mode Deployment
```env
NODE_ENV=production
LOG_LEVEL=debug
DEBUG=*
```

This completes the deployment guide. Choose the option that best fits your needs and infrastructure requirements.