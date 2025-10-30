import { bindClassMethods } from "../utils/bind-class-methods";


export function AutoBind(target: any) {
   bindClassMethods(target.prototype);
}
