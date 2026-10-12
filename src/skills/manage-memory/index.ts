import {
  ManageMemoryInput,
  ManageMemoryInputSchema,
  ManageMemoryOutput,
} from "../../domain/memory";
import { manageMemoryDeterministically } from "./deterministic";

export class ManageMemoryService {
  async manage(input: ManageMemoryInput): Promise<ManageMemoryOutput> {
    const validatedInput = ManageMemoryInputSchema.parse(input);
    return manageMemoryDeterministically(validatedInput);
  }
}
