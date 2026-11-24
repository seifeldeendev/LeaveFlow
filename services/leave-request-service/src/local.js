// Local run: npm run dev  ->  http://localhost:3000
import 'dotenv/config';
const { default: app } = await import('./app.js');
const port = Number(process.env.PORT) || 3000;
app.listen(port, (err) => {
  if (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${port} is already in use - another copy of the server is still running. Close it, then run npm run dev again.`
      : `Server could not start: ${err.message}`);
    process.exit(1);
  }
  console.log(`leave-request-service on http://localhost:${port}`);
});
