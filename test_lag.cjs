const start = Date.now();
setTimeout(() => {
  const lag = Date.now() - start - 1000;
  console.log(`Event loop lag: ${lag}ms`);
}, 1000);
