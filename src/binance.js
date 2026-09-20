const crypto = require('crypto');

const BINANCE_BASE_URL = 'https://api.binance.com';
let timeOffset = 0;
let lastSyncTime = 0;

/**
 * Synchronize local time with Binance server time
 */
async function syncServerTime() {
    try {
        const response = await fetch(`${BINANCE_BASE_URL}/api/v3/time`);
        const data = await response.json();
        if (data.serverTime) {
            timeOffset = data.serverTime - Date.now();
            lastSyncTime = Date.now();
        }
    } catch (err) {
        console.error('Error syncing Binance server time:', err.message);
    }
}

/**
 * Signs query string with HMAC SHA256 using Binance API Secret
 */
function createSignature(queryString, apiSecret) {
    return crypto
        .createHmac('sha256', apiSecret)
        .update(queryString)
        .digest('hex');
}

/**
 * Checks Binance Pay transaction history for a specific Order ID or Transaction ID
 * Endpoint: GET /sapi/v1/pay/transactions
 */
async function checkBinancePayOrder(targetId) {
    const apiKey = process.env.BINANCE_API_KEY;
    const apiSecret = process.env.BINANCE_API_SECRET;

    if (!apiKey || !apiSecret) {
        return {
            configured: false,
            message: 'Binance API Key / Secret is not configured in .env',
        };
    }

    try {
        // Resync time every 15 minutes
        if (!timeOffset || Date.now() - lastSyncTime > 15 * 60 * 1000) {
            await syncServerTime();
        }

        const timestamp = Date.now() + timeOffset;
        // Look back 7 days (7 * 24 * 60 * 60 * 1000)
        const startTime = timestamp - 7 * 24 * 60 * 60 * 1000;
        const queryString = `startTimestamp=${startTime}&recvWindow=60000&timestamp=${timestamp}`;
        const signature = createSignature(queryString, apiSecret);

        const url = `${BINANCE_BASE_URL}/sapi/v1/pay/transactions?${queryString}&signature=${signature}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'X-MBX-APIKEY': apiKey,
                'Content-Type': 'application/json',
            },
        });

        const data = await response.json();

        if (data.code && data.code !== '000000') {
            return {
                configured: true,
                success: false,
                error: data.message || `Binance API Code: ${data.code}`,
            };
        }

        const transactions = data.data || [];
        const cleanTargetId = targetId.trim();

        // Search for matching orderId or transactionId
        const match = transactions.find((tx) => {
            const matchOrder = tx.orderId && tx.orderId.toString() === cleanTargetId;
            const matchTx = tx.transactionId && tx.transactionId.toString() === cleanTargetId;
            return matchOrder || matchTx;
        });

        if (match) {
            const amount = parseFloat(match.amount);

            // Ensure this is an incoming transaction (positive amount)
            if (amount <= 0) {
                return {
                    configured: true,
                    success: false,
                    found: true,
                    message: 'This transaction was an outgoing transfer, not a deposit.',
                };
            }

            return {
                configured: true,
                success: true,
                found: true,
                amount: amount,
                currency: match.currency || 'USDT',
                orderId: match.orderId,
                transactionId: match.transactionId,
                payerName: match.payerInfo?.name || 'Binance User',
                transactionTime: match.transactionTime,
            };
        }

        return {
            configured: true,
            success: false,
            found: false,
            message: 'Order ID not found in recent Binance Pay transactions.',
        };
    } catch (err) {
        return {
            configured: true,
            success: false,
            error: err.message,
        };
    }
}

module.exports = {
    syncServerTime,
    checkBinancePayOrder,
};
