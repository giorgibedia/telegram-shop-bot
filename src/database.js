const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const config = require('./config');

const dbPath = path.resolve(__dirname, '..', config.DATABASE_FILE);
const db = new DatabaseSync(dbPath);

function initDb() {
    // 1. Users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            balance REAL DEFAULT 0.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 2. Products table
    db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            warranty TEXT,
            stock_content TEXT,
            is_active INTEGER DEFAULT 1
        );
    `);

    // 3. Orders table
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            price REAL NOT NULL,
            delivery_content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // 4. Deposits table
    db.exec(`
        CREATE TABLE IF NOT EXISTS deposits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            username TEXT,
            amount REAL NOT NULL,
            method TEXT DEFAULT 'Binance Pay',
            tx_id TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_deposits_tx_unique ON deposits(tx_id) WHERE tx_id != '' AND status = 'approved';
    `);

    // 5. Account Stock / Inventory table (for real accounts added by Owner)
    db.exec(`
        CREATE TABLE IF NOT EXISTS account_stock (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            account_content TEXT NOT NULL,
            status TEXT DEFAULT 'available',
            order_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            sold_at DATETIME
        );
    `);

    // Seed default products in clean, polished English
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM products');
    const result = countStmt.get();
    if (result.count === 0) {
        seedProducts();
    }
}

function seedProducts() {
    const insertProduct = db.prepare(`
        INSERT INTO products (name, description, price, warranty, stock_content)
        VALUES (?, ?, ?, ?, ?)
    `);

    insertProduct.run(
        '🧠 ChatGPT Plus ✦ 1 Month',
        '✨ **OpenAI ChatGPT Plus Subscription (Private Account)**\n\n' +
        '🟢 **Status:** Real Inventory System\n' +
        '🛡️ **Warranty:** 100% Full 30-Day Guarantee\n\n' +
        '⚡ **Account Features:**\n' +
        '▸ 🧠 Full Unlimited ChatGPT Plus Access\n' +
        '▸ ⚡ Priority Turbo Peak Speeds\n' +
        '▸ 🔗 Direct 2FA One-Click Login Link',
        5.5,
        '🛡️ Full Warranty (30 Days)',
        ''
    );

    insertProduct.run(
        '🎓 GPT K-12 Teacher ✦ 2 Years',
        '🎓 **ChatGPT K-12 Teacher Plan (2 Years Access)**\n\n' +
        '💵 **Price:** $6.50 / 2 Years\n' +
        '🛡️ **Warranty:** 25 Days Warranty\n' +
        '📚 **Category:** AI Tools for Education & Teaching\n' +
        '🟢 **Status:** Real Inventory System\n\n' +
        '⚡ **Account Features:**\n' +
        '▸ 🎓 Full 2-Year K-12 Teacher Plan Access\n' +
        '▸ 📚 Complete OpenAI Tools for Education & Teaching\n' +
        '▸ 🧠 Advanced Reasoning & Curriculum Tools\n' +
        '▸ 🔗 Direct 2FA One-Click Login Link',
        6.5,
        '🛡️ 25 Days Warranty',
        ''
    );
}

// User operations
function getOrCreateUser(id, username = '', firstName = '') {
    const findStmt = db.prepare('SELECT * FROM users WHERE id = ?');
    let user = findStmt.get(id);

    if (!user) {
        const insertStmt = db.prepare(`
            INSERT INTO users (id, username, first_name, balance)
            VALUES (?, ?, ?, 0.0)
        `);
        insertStmt.run(id, username || '', firstName || '');
        user = findStmt.get(id);
    } else {
        if (user.username !== username || user.first_name !== firstName) {
            const updateStmt = db.prepare(`
                UPDATE users SET username = ?, first_name = ? WHERE id = ?
            `);
            updateStmt.run(username || '', firstName || '', id);
            user = findStmt.get(id);
        }
    }
    return user;
}

function getUser(id) {
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
}

function updateBalance(id, delta) {
    const stmt = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
    stmt.run(delta, id);
    return getUser(id);
}

function setBalance(id, newBalance) {
    const stmt = db.prepare('UPDATE users SET balance = ? WHERE id = ?');
    stmt.run(newBalance, id);
    return getUser(id);
}

function getAllUsers() {
    const stmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    return stmt.all();
}

function getUserStats() {
    const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const ordersCount = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(price), 0) as total_volume FROM orders').get();
    const depositsCount = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total_deposits FROM deposits WHERE status = 'approved'").get();
    return {
        totalUsers: usersCount,
        totalOrders: ordersCount.count,
        totalVolume: ordersCount.total_volume,
        totalDeposits: depositsCount.total_deposits,
    };
}

// Product operations
function getProducts() {
    const stmt = db.prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC');
    return stmt.all();
}

function getProductById(id) {
    const stmt = db.prepare('SELECT * FROM products WHERE id = ?');
    return stmt.get(id);
}

function resetProductsToEnglish() {
    db.exec('DELETE FROM products;');
    seedProducts();
}

// Order operations
function createOrder(userId, productId, productName, price, deliveryContent) {
    const stmt = db.prepare(`
        INSERT INTO orders (user_id, product_id, product_name, price, delivery_content)
        VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(userId, productId, productName, price, deliveryContent);
    return info.lastInsertRowid;
}

function updateOrderDelivery(orderId, deliveryContent) {
    const stmt = db.prepare('UPDATE orders SET delivery_content = ? WHERE id = ?');
    stmt.run(deliveryContent, orderId);
}

function getUserOrders(userId) {
    const stmt = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC');
    return stmt.all(userId);
}

// Deposit operations
function createDeposit(userId, username, amount, method, txId) {
    const stmt = db.prepare(`
        INSERT INTO deposits (user_id, username, amount, method, tx_id, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
    `);
    const info = stmt.run(userId, username || '', amount, method, txId || '');
    return info.lastInsertRowid;
}

function getDepositById(id) {
    const stmt = db.prepare('SELECT * FROM deposits WHERE id = ?');
    return stmt.get(id);
}

function checkTxIdExists(txId) {
    if (!txId) return false;
    const cleanId = txId.trim();
    const stmt = db.prepare("SELECT id FROM deposits WHERE tx_id = ? OR tx_id LIKE ? LIMIT 1");
    return !!stmt.get(cleanId, `%${cleanId}%`);
}

function getPendingDeposits() {
    const stmt = db.prepare("SELECT * FROM deposits WHERE status = 'pending' ORDER BY created_at ASC");
    return stmt.all();
}

function updateDepositStatus(id, status) {
    const stmt = db.prepare('UPDATE deposits SET status = ? WHERE id = ?');
    stmt.run(status, id);
    return getDepositById(id);
}

function getUserDeposits(userId) {
    const stmt = db.prepare("SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 5");
    return stmt.all(userId);
}

// Account Stock / Inventory operations
function addStockAccount(productId, accountContent) {
    const stmt = db.prepare(`
        INSERT INTO account_stock (product_id, account_content, status)
        VALUES (?, ?, 'available')
    `);
    const info = stmt.run(productId, accountContent.trim());
    return info.lastInsertRowid;
}

function getAvailableStockCount(productId) {
    const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM account_stock
        WHERE product_id = ? AND status = 'available'
    `);
    return stmt.get(productId).count;
}

function getAvailableStock(productId) {
    const stmt = db.prepare(`
        SELECT * FROM account_stock
        WHERE product_id = ? AND status = 'available'
        ORDER BY id ASC
    `);
    return stmt.all(productId);
}

function getAllAvailableStock() {
    const stmt = db.prepare(`
        SELECT s.id, s.product_id, p.name as product_name, s.account_content, s.created_at
        FROM account_stock s
        JOIN products p ON s.product_id = p.id
        WHERE s.status = 'available'
        ORDER BY s.product_id ASC, s.id ASC
    `);
    return stmt.all();
}

function dispenseStockAccount(productId, orderId = null) {
    const stmt = db.prepare(`
        SELECT * FROM account_stock
        WHERE product_id = ? AND status = 'available'
        ORDER BY id ASC
        LIMIT 1
    `);
    const account = stmt.get(productId);
    if (!account) return null;

    const updateStmt = db.prepare(`
        UPDATE account_stock
        SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);
    updateStmt.run(orderId, account.id);
    return account;
}

function deleteStockAccount(id) {
    const stmt = db.prepare('DELETE FROM account_stock WHERE id = ?');
    stmt.run(id);
}

function dispenseMultipleStockAccounts(productId, count, orderId = null) {
    const stmt = db.prepare(`
        SELECT * FROM account_stock
        WHERE product_id = ? AND status = 'available'
        ORDER BY id ASC
        LIMIT ?
    `);
    const accounts = stmt.all(productId, count);
    if (accounts.length < count) {
        return null;
    }

    const updateStmt = db.prepare(`
        UPDATE account_stock
        SET status = 'sold', order_id = ?, sold_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `);
    for (const acc of accounts) {
        updateStmt.run(orderId, acc.id);
    }
    return accounts;
}

/**
 * Generate full human-readable SQL dump (.sql) of all tables and data
 */
function generateSqlDump() {
    const tables = ['users', 'products', 'orders', 'deposits', 'account_stock'];
    let dump = `-- =====================================================\n`;
    dump += `-- AI MARKETPLACE BOT - COMPLETE SQL DATABASE DUMP\n`;
    dump += `-- Generated At: ${new Date().toISOString()}\n`;
    dump += `-- =====================================================\n\n`;
    dump += `PRAGMA foreign_keys = OFF;\n\n`;

    for (const table of tables) {
        const schemaRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`).get(table);
        if (schemaRow && schemaRow.sql) {
            dump += `-- -----------------------------------------------------\n`;
            dump += `-- Table structure for "${table}"\n`;
            dump += `-- -----------------------------------------------------\n`;
            dump += `DROP TABLE IF EXISTS "${table}";\n`;
            dump += `${schemaRow.sql};\n\n`;
        }

        const rows = db.prepare(`SELECT * FROM "${table}"`).all();
        if (rows.length > 0) {
            dump += `-- Dumping data for table "${table}" (${rows.length} records)\n`;
            for (const row of rows) {
                const cols = Object.keys(row);
                const colList = cols.map(c => `"${c}"`).join(', ');
                const valList = cols.map(c => {
                    const val = row[c];
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'number') return val;
                    return `'${String(val).replace(/'/g, "''")}'`;
                }).join(', ');
                dump += `INSERT INTO "${table}" (${colList}) VALUES (${valList});\n`;
            }
            dump += '\n';
        }
    }

    // Indexes
    const indexRows = db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`).all();
    if (indexRows.length > 0) {
        dump += `-- -----------------------------------------------------\n`;
        dump += `-- Indexes\n`;
        dump += `-- -----------------------------------------------------\n`;
        for (const idx of indexRows) {
            dump += `${idx.sql};\n`;
        }
        dump += '\n';
    }

    dump += `PRAGMA foreign_keys = ON;\n`;
    dump += `-- ======================= END OF DUMP =======================\n`;
    return dump;
}

/**
 * Execute an arbitrary SQL script (used for database restoration)
 */
function executeSql(sqlContent) {
    if (!sqlContent || typeof sqlContent !== 'string') {
        throw new Error('Invalid SQL script content');
    }
    db.exec(sqlContent);
    return true;
}

/**
 * Get path to active SQLite database file
 */
function getDbPath() {
    return dbPath;
}

/**
 * Save backup copies (.sql and .db) to disk
 */
function saveLocalBackup(customDir = null) {
    const fs = require('fs');
    const dir = customDir || path.resolve(__dirname, '..', 'backups');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sqlFileName = `ai_market_backup_${timestamp}.sql`;
    const dbFileName = `ai_market_backup_${timestamp}.db`;
    const sqlPath = path.join(dir, sqlFileName);
    const dbCopyPath = path.join(dir, dbFileName);

    const sqlContent = generateSqlDump();
    fs.writeFileSync(sqlPath, sqlContent, 'utf-8');
    if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, dbCopyPath);
    }

    return {
        sqlPath,
        dbCopyPath,
        sqlFileName,
        dbFileName,
        sqlContent,
        timestamp
    };
}

module.exports = {
    initDb,
    seedProducts,
    resetProductsToEnglish,
    getOrCreateUser,
    getUser,
    updateBalance,
    setBalance,
    getAllUsers,
    getUserStats,
    getProducts,
    getProductById,
    createOrder,
    updateOrderDelivery,
    getUserOrders,
    createDeposit,
    getDepositById,
    checkTxIdExists,
    getPendingDeposits,
    updateDepositStatus,
    getUserDeposits,
    addStockAccount,
    getAvailableStockCount,
    getAvailableStock,
    getAllAvailableStock,
    dispenseStockAccount,
    dispenseMultipleStockAccounts,
    deleteStockAccount,
    generateSqlDump,
    executeSql,
    getDbPath,
    saveLocalBackup,
};
