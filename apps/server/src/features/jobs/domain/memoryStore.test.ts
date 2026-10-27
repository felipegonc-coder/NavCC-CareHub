import { createMemoryJobStore } from './memoryStore';
import { describeJobStoreContract } from './storeContract';

describeJobStoreContract('memory store', async () => createMemoryJobStore());
