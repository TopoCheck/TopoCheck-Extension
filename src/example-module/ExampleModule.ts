import { IModule } from "../core/interfaces/IModule";

export class ExampleModule implements IModule {
    name = "example";

    initialize(): void {
        console.log("Example module initialized");
    }
}