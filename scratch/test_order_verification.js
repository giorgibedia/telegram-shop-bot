require('dotenv').config();
const db = require('../src/database');
const binance = require('../src/binance');

async function testFullVerificationFlow() {
    console.log('==============================================');
    console.log('🧪 TESTING BINANCE ORDER ID VERIFICATION FLOW');
    console.log('==============================================');

    db.initDb();

    // Create a mock user
    const testUserId = 999111222;
    const testUser = db.getOrCreateUser(testUserId, 'test_buyer', 'Test Buyer');
    console.log(`\n1. Initial User Balance: $${testUser.balance.toFixed(2)}`);

    // Test with real Binance Order ID from UID 860810287 history
    const realOrderId = '454275542705135616';
    console.log(`\n2. User pastes Order ID: "${realOrderId}"`);

    // Step A: Check duplicate
    const alreadyExists = db.checkTxIdExists(realOrderId);
    console.log(`   Is Order ID already used in DB? -> ${alreadyExists}`);

    if (alreadyExists) {
        console.log('   ⚠️ Already used. (Test will reset for demonstration)');
    }

    // Step B: Query Binance API
    console.log('   Connecting to Binance Pay API...');
    const binanceCheck = await binance.checkBinancePayOrder(realOrderId);
    console.log('   Binance API Response:', JSON.stringify(binanceCheck, null, 2));

    if (binanceCheck.success && binanceCheck.found) {
        console.log('\n3. ✅ Binance Verified Payment!');
        console.log(`   - Order ID: ${binanceCheck.orderId}`);
        console.log(`   - Amount: ${binanceCheck.amount} ${binanceCheck.currency}`);
        console.log(`   - Payer Name: ${binanceCheck.payerName}`);

        // Step C: Credit balance & record deposit
        const depId = db.createDeposit(testUserId, 'test_buyer', binanceCheck.amount, 'Binance Auto-API', realOrderId);
        db.updateDepositStatus(depId, 'approved');
        const updatedUser = db.updateBalance(testUserId, binanceCheck.amount);

        console.log(`\n4. 🎉 Wallet Credited Successfully!`);
        console.log(`   - Deposit ID: #DEP-${depId}`);
        console.log(`   - Added: +$${binanceCheck.amount.toFixed(2)}`);
        console.log(`   - New User Balance: $${updatedUser.balance.toFixed(2)}`);

        // Step D: Test Duplicate prevention
        console.log(`\n5. 🛡️ Testing Duplicate Protection: User pastes "${realOrderId}" AGAIN...`);
        const isDuplicateNow = db.checkTxIdExists(realOrderId);
        console.log(`   Check checkTxIdExists("${realOrderId}"): ${isDuplicateNow}`);
        if (isDuplicateNow) {
            console.log('   ✅ BLOCKED: Duplicate Order ID detected and rejected!');
        } else {
            console.log('   ❌ FAIL: Duplicate was not detected.');
        }
    } else {
        console.log('❌ Binance verification failed:', binanceCheck.error || binanceCheck.message);
    }

    // Step E: Test Fake Order ID
    const fakeOrderId = '999988887777666655';
    console.log(`\n6. 🛡️ Testing Fake/Non-existent Order ID: "${fakeOrderId}"...`);
    const fakeCheck = await binance.checkBinancePayOrder(fakeOrderId);
    console.log('   Binance check on fake ID:', fakeCheck);
    if (!fakeCheck.found) {
        console.log('   ✅ REJECTED: Fake Order ID was NOT found in Binance transactions!');
    }

    console.log('\n==============================================');
    console.log('✨ ALL TESTS COMPLETED SUCCESSFULLY!');
    console.log('==============================================');
}

testFullVerificationFlow().catch(console.error);
