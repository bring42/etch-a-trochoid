declare module "matter-js" {
  export type Vertex = {
    x: number;
    y: number;
  };

  export type Collision = {
    depth?: number;
  };

  export type Body = {
    position: Vertex;
  };

  type BodyOptions = {
    isStatic?: boolean;
  };

  type MatterModule = {
    Bodies: {
      fromVertices(x: number, y: number, vertexSets: Vertex[][], options?: BodyOptions, flagInternal?: boolean): Body | null;
    };
    Query: {
      collides(body: Body, bodies: Body[]): Collision[];
    };
  };

  const Matter: MatterModule;
  export default Matter;
}
