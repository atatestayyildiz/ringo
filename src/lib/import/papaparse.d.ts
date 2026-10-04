// papaparse tür tanımı paketle gelmez; yalnız kullandığımız yüzey tanımlandı.
declare module "papaparse" {
  export type ParseError = { type: string; code: string; message: string; row?: number };
  export type ParseResult<T> = { data: T[]; errors: ParseError[]; meta: { delimiter: string } };
  export type ParseConfig = { delimiter?: string; skipEmptyLines?: boolean | "greedy" };
  const Papa: {
    parse<T = string[]>(input: string, config?: ParseConfig): ParseResult<T>;
  };
  export default Papa;
}
