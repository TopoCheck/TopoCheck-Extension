export interface IModule {
    name: string;
    initialize(): void;
}