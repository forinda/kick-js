import {
  KickController,
  KickDelete,
  KickGet,
  KickInject,
  KickPatch,
  KickPost,
} from "@forinda/kickjs";
import { BoardService } from '../services/board.service';

@KickController('/board')
export class BoardController {
  constructor(@KickInject(BoardService) private readonly board: BoardService) {}

  @KickGet('/tasks')
  list() {
    const state = this.board.list();
    return { tasks: state.tasks, metrics: state.metrics };
  }

  @KickPost('/tasks')
  create(req: { body: { title: string; description?: string } }) {
    const task = this.board.create({
      title: req.body.title,
      description: req.body.description
    });
    return { task };
  }

  @KickPatch('/tasks/:id/transition')
  transition(req: { params: { id: string }; body: { direction: 'forward' | 'back' } }) {
    const direction = req.body.direction;
    const task =
      direction === 'forward'
        ? this.board.advance(req.params.id)
        : this.board.revert(req.params.id);

    if (!task) {
      return { updated: false };
    }

    return { task, updated: true };
  }

  @KickDelete('/tasks/:id')
  remove(req: { params: { id: string } }) {
    const deleted = this.board.remove(req.params.id);
    return { success: deleted };
  }
}
