const schedule = require('node-schedule');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../config/config.json');

// 获取当前环境配置
const env = process.env.NODE_ENV || 'development';
const dbConfig = config[env];

// 备份目录路径：项目根目录/database/backup
// 注意：当前文件在 backend/services/，所以是 ../../database/backup
const BACKUP_DIR = path.join(__dirname, '../../database/backup');

// 确保备份目录存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * 执行数据库备份
 */
const backupDatabase = () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `backup-${dbConfig.database}-${timestamp}.sql`;
  const filePath = path.join(BACKUP_DIR, filename);

  console.log(`[备份服务] 开始备份数据库: ${dbConfig.database}...`);

  // 确定 mysqldump 路径
  // 1. 优先使用环境变量配置
  // 2. 其次尝试常见路径
  // 3. 最后默认使用 'mysqldump' (依赖 PATH)
  let mysqldumpPath = process.env.MYSQLDUMP_PATH || 'mysqldump';
  
  // 如果环境变量未设置，尝试自动探测
  if (!process.env.MYSQLDUMP_PATH) {
    const commonPaths = [
      '/opt/anaconda3/bin/mysqldump', // 用户环境发现的路径
      '/usr/local/mysql/bin/mysqldump',
      '/usr/local/bin/mysqldump',
      '/opt/homebrew/bin/mysqldump',
      '/usr/bin/mysqldump'
    ];
    
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        mysqldumpPath = p;
        break;
      }
    }
  }

  // 构建参数数组
  const args = [
    '-h', dbConfig.host,
    '-u', dbConfig.username,
    // 密码通过环境变量传递，不通过参数
    dbConfig.database
  ];

  // 创建写入流
  const writeStream = fs.createWriteStream(filePath);

  // 启动子进程
  const dumpProcess = spawn(mysqldumpPath, args, {
    env: { ...process.env, MYSQL_PWD: dbConfig.password }
  });

  // 将 stdout 管道到文件
  dumpProcess.stdout.pipe(writeStream);

  // 监听 stderr 输出
  dumpProcess.stderr.on('data', (data) => {
    // mysqldump 的 stderr 包含进度信息，不一定是错误
    // 只有当进程以非 0 退出时才认为是错误
    // console.log(`[备份服务] mysqldump output: ${data}`);
  });

  // 监听错误事件（如命令未找到）
  dumpProcess.on('error', (error) => {
    console.error(`[备份服务] 启动备份进程失败: ${error.message}`);
    // 如果文件被创建了但进程失败，可能需要删除空文件
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });

  // 监听退出事件
  dumpProcess.on('close', (code) => {
    if (code === 0) {
      console.log(`[备份服务] 数据库备份成功: ${filename}`);
      cleanOldBackups();
    } else {
      console.error(`[备份服务] 备份进程退出，代码: ${code}`);
      // 检查文件是否为空或损坏，这里简单起见，如果非0退出则删除文件
      if (fs.existsSync(filePath)) {
        // 读取文件大小，如果为0则删除
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          fs.unlinkSync(filePath);
        } else {
           // 保留可能有用的部分输出，或者重命名为 .failed
           const failedPath = filePath + '.failed';
           fs.renameSync(filePath, failedPath);
           console.error(`[备份服务] 失败的备份已重命名为: ${path.basename(failedPath)}`);
        }
      }
    }
  });
};

/**
 * 清理过期备份文件（保留最近 15 天）
 */
const cleanOldBackups = () => {
  const retentionDays = 15;
  const now = Date.now();
  const retentionPeriod = retentionDays * 24 * 60 * 60 * 1000;

  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) {
      console.error(`[备份服务] 读取备份目录失败: ${err.message}`);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(BACKUP_DIR, file);
      
      // 只处理 .sql 结尾的备份文件
      if (!file.endsWith('.sql')) return;

      fs.stat(filePath, (err, stats) => {
        if (err) {
          console.error(`[备份服务] 获取文件状态失败: ${file}, ${err.message}`);
          return;
        }

        if (now - stats.mtime.getTime() > retentionPeriod) {
          fs.unlink(filePath, (err) => {
            if (err) {
              console.error(`[备份服务] 删除过期备份失败: ${file}, ${err.message}`);
            } else {
              console.log(`[备份服务] 已删除过期备份: ${file}`);
            }
          });
        }
      });
    });
  });
};

/**
 * 初始化备份服务
 */
const initBackupService = () => {
  console.log('[备份服务] 初始化完成，将在每天凌晨 01:00 执行备份');
  
  // 每天凌晨 1 点执行 (0 0 1 * * *)
  schedule.scheduleJob('0 0 1 * * *', () => {
    backupDatabase();
  });
};

module.exports = {
  initBackupService,
  backupDatabase // 导出以便手动测试
};
