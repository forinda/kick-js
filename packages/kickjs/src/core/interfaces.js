import 'reflect-metadata';
/** Lifecycle scope for DI registrations */
export var Scope;
(function (Scope) {
    Scope["SINGLETON"] = "singleton";
    Scope["TRANSIENT"] = "transient";
})(Scope || (Scope = {}));
/** Symbol-based metadata keys for the DI system */
export const METADATA = {
    INJECTABLE: Symbol('kick:injectable'),
    SCOPE: Symbol('kick:scope'),
    AUTOWIRED: Symbol('kick:autowired'),
    INJECT: Symbol('kick:inject'),
    POST_CONSTRUCT: Symbol('kick:post_construct'),
    BUILDER: Symbol('kick:builder'),
    QUERY_PARAMS: Symbol('kick:query:params'),
    CONTROLLER_PATH: Symbol('kick:controller:path'),
    ROUTES: Symbol('kick:routes'),
    CLASS_MIDDLEWARES: Symbol('kick:class:middlewares'),
    METHOD_MIDDLEWARES: Symbol('kick:method:middlewares'),
    FILE_UPLOAD: Symbol('kick:file:upload'),
    VALUE: Symbol('kick:value'),
    // TypeScript emit metadata keys
    PARAM_TYPES: 'design:paramtypes',
    PROPERTY_TYPE: 'design:type',
    RETURN_TYPE: 'design:returntype',
};
//# sourceMappingURL=interfaces.js.map