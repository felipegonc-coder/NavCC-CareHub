import { createMemoryAutomationStore } from './memoryStore';
import { describeAutomationStoreContract } from './storeContract';

describeAutomationStoreContract('memory store', async () => createMemoryAutomationStore());
