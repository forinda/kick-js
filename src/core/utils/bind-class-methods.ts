export function bindClassMethods(instance: any) {
    const proto = Object.getPrototypeOf(instance);
    const methods = Object.getOwnPropertyNames(proto).filter(
        (prop) => typeof instance[prop] === "function" && prop !== "constructor"
    );

    methods.forEach((method) => {
        instance[method] = instance[method].bind(instance);
    });
}
