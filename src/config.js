require('dotenv').config();

module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN || '8596157775:AAHxymuUiTreO6af8f6T8MCb5GqleGF017c',
    ADMIN_ID: process.env.ADMIN_ID ? parseInt(process.env.ADMIN_ID, 10) : null,
    BINANCE_PAY_ID: process.env.BINANCE_PAY_ID || '860810287',
    BINANCE_PAY_NICKNAME: process.env.BINANCE_PAY_NICKNAME || 'User-6b08b',
    DATABASE_FILE: 'bot_database.db',
};
