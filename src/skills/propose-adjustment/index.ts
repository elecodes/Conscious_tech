import {
  ProposeAdjustmentInput,
  ProposeAdjustmentInputSchema,
  ProposeAdjustmentOutput,
} from "../../domain/adjustment";
import { proposeAdjustmentsDeterministically } from "./deterministic";

export class ProposeAdjustmentService {
  async propose(input: ProposeAdjustmentInput): Promise<ProposeAdjustmentOutput> {
    const validatedInput = ProposeAdjustmentInputSchema.parse(input);
    return proposeAdjustmentsDeterministically(validatedInput);
  }
}
