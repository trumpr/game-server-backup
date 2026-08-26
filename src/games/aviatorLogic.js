function generateAviatorCrashPoint() {
    const r = Math.random();
    if (r < 0.03) return 1.00;
    if (r < 0.33) return parseFloat((1.01 + Math.random() * 0.49).toFixed(2));
    const result = 0.97 / (1.0 - Math.random());
    return parseFloat(Math.min(Math.max(result, 1.01), 1000.00).toFixed(2));
}

module.exports = {
    generateAviatorCrashPoint
};
