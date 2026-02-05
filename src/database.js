// IP 数据库管理器
export class IPDatabase {
  constructor(env) {
    this.env = env;
    this.db = null;
    this.dbInfo = null;
    this.cache = new Map();
    this.cacheTTL = 300000; // 5分钟缓存
    this.lastFetchTime = 0;
  }

  async initialize() {
    console.log('Initializing IP database...');
    
    // 尝试从不同来源加载数据库
    await this.loadDatabase();
    
    // 定时刷新数据库
    setInterval(() => this.cleanCache(), 60000); // 每分钟清理缓存
  }

  async loadDatabase() {
    try {
      // 优先从环境变量获取数据库URL
      const dbUrl = this.env.DATABASE_URL || 
                   'https://raw.githubusercontent.com/你的用户名/仓库名/main/data/geoip.dat';
      
      console.log(`Loading database from: ${dbUrl}`);
      
      const response = await fetch(dbUrl, {
        headers: {
          'User-Agent': 'Cloudflare-Worker-IP-DB/1.0',
          'If-Modified-Since': this.lastFetchTime ? new Date(this.lastFetchTime).toUTCString() : ''
        }
      });

      if (response.status === 304) {
        console.log('Database not modified');
        return;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch database: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      this.db = new DataView(arrayBuffer);
      this.lastFetchTime = Date.now();
      
      // 解析数据库信息
      this.dbInfo = this.parseDatabaseInfo(arrayBuffer);
      
      console.log(`Database loaded: ${this.dbInfo.size} bytes, ${this.dbInfo.recordCount} records`);
      
    } catch (error) {
      console.error('Failed to load database:', error);
      
      // 如果加载失败，使用内置的备份数据库或返回错误
      if (!this.db) {
        this.db = this.createFallbackDatabase();
      }
    }
  }

  parseDatabaseInfo(arrayBuffer) {
    // 根据你的dat文件格式解析
    // 这里假设格式：前8字节是头信息
    const view = new DataView(arrayBuffer);
    
    return {
      size: arrayBuffer.byteLength,
      format: 'ipip.net dat format',
      version: view.getUint32(0, false) || 1,
      recordCount: Math.floor((arrayBuffer.byteLength - 8) / 12), // 假设每条记录12字节
      lastUpdated: new Date().toISOString()
    };
  }

  createFallbackDatabase() {
    console.log('Creating fallback database');
    // 创建一个简单的回退数据库
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, 1, false); // 版本
    view.setUint32(4, 0, false); // 记录数
    return view;
  }

  async query(ip) {
    const cacheKey = `ip:${ip}`;
    const now = Date.now();
    
    // 检查缓存
    const cached = this.cache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }
    
    if (!this.db) {
      await this.loadDatabase();
    }
    
    // 查询IP
    const result = this.lookupIP(ip);
    
    // 缓存结果
    this.cache.set(cacheKey, {
      data: result,
      timestamp: now
    });
    
    return result;
  }

  lookupIP(ip) {
    if (!this.db) {
      return {
        country: 'Unknown',
        region: 'Unknown',
        city: 'Unknown',
        isp: 'Unknown',
        latitude: null,
        longitude: null
      };
    }

    try {
      const ipInt = this.ipToInt(ip);
      
      // 二分查找算法
      let left = 0;
      let right = this.dbInfo.recordCount - 1;
      
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const offset = 8 + (mid * 12); // 假设每条记录12字节
        
        const startIp = this.db.getUint32(offset, false);
        const endIp = this.db.getUint32(offset + 4, false);
        
        if (ipInt >= startIp && ipInt <= endIp) {
          const dataOffset = this.db.getUint32(offset + 8, false);
          return this.parseGeoData(dataOffset);
        } else if (ipInt < startIp) {
          right = mid - 1;
        } else {
          left = mid + 1;
        }
      }
    } catch (error) {
      console.error('IP lookup error:', error);
    }
    
    return {
      country: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      isp: 'Unknown',
      latitude: null,
      longitude: null
    };
  }

  ipToInt(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4) {
      throw new Error('Invalid IPv4 address');
    }
    
    return (parseInt(parts[0]) << 24) |
           (parseInt(parts[1]) << 16) |
           (parseInt(parts[2]) << 8) |
           parseInt(parts[3]);
  }

  parseGeoData(offset) {
    try {
      // 根据实际dat格式解析
      // 这里假设格式：字符串以0结尾
      let data = '';
      for (let i = offset; i < this.db.byteLength; i++) {
        const byte = this.db.getUint8(i);
        if (byte === 0) break;
        data += String.fromCharCode(byte);
      }
      
      // 假设格式：国家|省份|城市|运营商|纬度|经度
      const parts = data.split('|');
      
      return {
        country: parts[0] || 'Unknown',
        region: parts[1] || 'Unknown',
        city: parts[2] || 'Unknown',
        isp: parts[3] || 'Unknown',
        latitude: parts[4] ? parseFloat(parts[4]) : null,
        longitude: parts[5] ? parseFloat(parts[5]) : null,
        raw_data: data
      };
    } catch (error) {
      console.error('Parse geo data error:', error);
      return {
        country: 'Unknown',
        region: 'Unknown',
        city: 'Unknown',
        isp: 'Unknown',
        latitude: null,
        longitude: null
      };
    }
  }

  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }

  async getInfo() {
    return {
      ...this.dbInfo,
      cache_size: this.cache.size,
      last_fetch: new Date(this.lastFetchTime).toISOString()
    };
  }
}
