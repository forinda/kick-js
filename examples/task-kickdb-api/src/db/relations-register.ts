// Hand-rolled `KickDbRelationsRegister` augmentation. Mirrors what
// the kick/db typegen plugin will eventually emit alongside the
// existing `KickDbRegister` augmentation in
// `.kickjs/types/kick__db.d.ts` (the relations side is a follow-up
// to M3.A.4 — typegen extension lands later).
//
// Until typegen catches up, hand-write the subset your code
// references in `db.query.X.findMany({ with: ... })` calls. Keys
// listed here unlock auto-completion + compile-time checks; relations
// declared in `./schema/relations.ts` but absent from this
// augmentation simply produce a `never` for the `with` clause.
//
// Side-effect import (no runtime exports): pull this file into your
// app entry once so the augmentation lands in scope project-wide.

declare module '@forinda/kickjs-db' {
  interface KickDbRelationsRegister {
    db: {
      tasks: {
        comments: { kind: 'many'; target: 'comments' }
        assignees: { kind: 'many'; target: 'task_assignees' }
        labels: { kind: 'many'; target: 'task_labels' }
        subtasks: { kind: 'many'; target: 'tasks' }
        parentTask: { kind: 'one'; target: 'tasks' }
        reporter: { kind: 'one'; target: 'users' }
      }
    }
  }
}

export {}
