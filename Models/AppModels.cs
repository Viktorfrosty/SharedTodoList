namespace SharedTodoList.Models;

public class UserProfile
{
    public string Uid { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PhotoURL { get; set; } = string.Empty;
}

public class TodoList
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string OwnerUid { get; set; } = string.Empty;
    public List<string> Members { get; set; } = new();
    public long CreatedAt { get; set; }
    public bool DeletionInProgress { get; set; }
    public bool Deleted { get; set; }
}

public class TodoTask
{
    public string Id { get; set; } = string.Empty;
    public string ListId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public bool IsCompleted { get; set; } = false;
    public string AssignedToEmail { get; set; } = string.Empty;
    public string CreatedByUid { get; set; } = string.Empty;
}