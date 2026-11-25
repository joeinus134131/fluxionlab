import { createDocumentStore, DocumentError } from "./document-store";
import { boardSchema, EMPTY_BOARD, type Board, type BoardOperation, type BoardState } from "./pcb";

const documents = createDocumentStore<Board>({ name: "pcb", key: "board", schema: boardSchema, empty: EMPTY_BOARD });

const toState = ({ version, value }: { version: number; value: Board }): BoardState => ({ version, board: value });

export const getBoardState = (): BoardState => toState(documents.get());

/** Akses dokumen untuk penyimpanan percakapan. */
export const boardDocument = {
  get: () => documents.get().value,
  isEmpty: () => documents.get().value.components.length === 0,
  parse: (saved: unknown) => (saved === undefined ? EMPTY_BOARD : boardSchema.parse(saved)),
  reset: (value: unknown) => void documents.reset(boardSchema.parse(value)),
  state: getBoardState,
};

type Change = Exclude<BoardOperation, { op: "undo" | "redo" }>;

function change(board: Board, operation: Change): Board {
  const requireRef = (ref: string) => {
    if (!board.components.some((c) => c.ref === ref)) throw new DocumentError(`Komponen "${ref}" tidak ditemukan.`);
  };
  switch (operation.op) {
    case "replace":
      return operation.board;
    case "rules": {
      const { name, width, height, trackWidth } = { ...board, ...operation.rules };
      return { ...board, name, width, height, trackWidth };
    }
    case "move": {
      requireRef(operation.ref);
      const { x, y, rotation } = operation;
      return {
        ...board,
        components: board.components.map((c) => (c.ref === operation.ref ? { ...c, x, y, rotation } : c)),
      };
    }
    case "remove": {
      requireRef(operation.ref);
      return {
        ...board,
        components: board.components.filter((c) => c.ref !== operation.ref),
        nets: board.nets
          .map((net) => ({ ...net, pins: net.pins.filter((pin) => pin.split(".")[0] !== operation.ref) }))
          .filter((net) => net.pins.length > 0),
      };
    }
  }
}

export function applyBoardOperation(operation: BoardOperation): BoardState {
  if (operation.op === "undo") return toState(documents.undo());
  if (operation.op === "redo") return toState(documents.redo());
  return toState(documents.commit((board) => change(board, operation)));
}
