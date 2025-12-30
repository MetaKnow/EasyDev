const schedule = require('node-schedule');
const { exec } = require('child_process');
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

  // 构建 mysqldump 命令
  // 注意：密码可能包含特殊字符，建议通过环境变量或配置文件传递，这里简单起见直接拼接，但需注意安全
  // 更好的方式是在命令执行时通过 env 传递密码，避免密码出现在进程列表中
  const command = `mysqldump -h ${dbConfig.host} -u ${dbConfig.username} --password="${dbConfig.password}" ${dbConfig.database} > "${filePath}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`[备份服务] 备份失败: ${error.message}`);
      return;
    }
    if (stderr) {
      // mysqldump 可能会在 stderr 输出警告信息，不一定是错误
      // console.warn(`[备份服务] 警告: ${stderr}`);
    }
    console.log(`[备份服务] 数据库备份成功: ${filename}`);
    
    // 备份成功后清理旧文件
    cleanOldBackups();
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
