#!/usr/bin/env node

// Quick script to check if poller is running by checking logs
const { exec } = require('child_process');

console.log('🔍 Checking Bitcoin Ordinals Poller status...\n');

// Check for recent polling activity in logs
exec('tail -200 logs/*.log 2>/dev/null | grep -i "polling\\|poller" || echo "No log files found"', (err, stdout, stderr) => {
  if (stdout.includes('No log files found')) {
    console.log('❌ No log files found - logging might be going to console only');
    console.log('\n💡 Check your bot console output for:');
    console.log('   - "₿ Bitcoin Ordinals Poller initialized"');
    console.log('   - "₿ Bitcoin Ordinals Poller started"');
    console.log('   - "₿ POLLING X Bitcoin Ordinals collections..."');
  } else {
    console.log('📋 Recent poller logs:\n');
    console.log(stdout);
  }
});
