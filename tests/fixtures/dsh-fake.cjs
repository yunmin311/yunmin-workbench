const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('0.1.2-rc.1');
  process.exit(0);
}
if (args.includes('--help')) {
  console.log('Usage: dsh --profile headless [task...]');
  process.exit(0);
}
process.exit(1);
