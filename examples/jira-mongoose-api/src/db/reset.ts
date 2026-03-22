import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI!;
if (!MONGODB_URI) {
  console.error('MONGODB_URI env variable is required');
  process.exit(1);
}

async function reset() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);

  const db = mongoose.connection.db!;
  const collections = await db.listCollections().toArray();

  for (const col of collections) {
    await db.dropCollection(col.name);
    console.log(`Dropped: ${col.name}`);
  }

  console.log(`\nReset complete — dropped ${collections.length} collections`);
  await mongoose.disconnect();
}

reset().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
