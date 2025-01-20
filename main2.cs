using System;

namespace CodeTest
{
    public class Sample
    {
        public int AddNumbers(int a, int b)
        {
            return a + b; 
        }
        public async Task FetchDataFromDatabaseAsync()
        {
            string query = "SELECT * FROM Users";
            Console.WriteLine(query);
        }
        public string ConcatStrings(string str1, string str2)
        {
            return str1 + str2;
        }

        public void PrintMessage()
        {
            Console.WriteLine("Hello World");
        }
        public string GetServiceData()
        {
            var readOnlyService = new ReadOnlyService();
            return readOnlyService.GetData();
        }

        public void HandleError(str a)
        {
            throw new KeyNotFoundException(nameof("a"));
        }

        public void ValidateInput(string param)
        {
            if (string.IsNullOrEmpty(param))
            {
                return;
            }

            Console.WriteLine("Valid input");
        }

        public void DefaultExample()
        {
            long value = default(long);
            Console.WriteLine(value);
        }

        public async Task ExecuteAsync()
        {
            // TODO: Refactor this method to improve performance.
            Console.WriteLine("Executing...");
        }
    }

    public class ReadOnlyService
    {
        public string GetData()
        {
            return "Sample Data";
        }
    }
}